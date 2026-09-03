// Package enginemon scrapes the Prometheus endpoint of the inference engine
// behind each channel (sglang) so the live status panel can show GPU-side
// pressure next to gateway-side demand.
//
// Everything here stays in memory. Scraping runs on its own HTTP client with a
// hard timeout so a hung GPU host can never consume relay connections.
package enginemon

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
)

const (
	// ScrapeInterval is well under a typical Prometheus scrape and far above
	// anything the engine notices: /metrics only serializes counters the
	// scheduler already maintains, it never touches the decode loop.
	ScrapeInterval = 5 * time.Second
	// ChannelRefreshInterval is how often the channel list is re-read.
	ChannelRefreshInterval = 30 * time.Second
	// scrapeTimeout must stay below ScrapeInterval so a stuck host cannot pile
	// scrapes on top of each other.
	scrapeTimeout  = 2 * time.Second
	maxResponseLen = 4 << 20
)

// EngineStats is one channel's engine-side state at the last successful scrape.
type EngineStats struct {
	ChannelID   int    `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	URL         string `json:"url"`

	// Fresh reports whether the last scrape succeeded. A channel that stops
	// being scrapable is usually a host that died, and this shows it sooner
	// than the periodic channel test does.
	Fresh     bool   `json:"fresh"`
	Error     string `json:"error,omitempty"`
	ScrapedAt int64  `json:"scraped_at"`
	AgeMs     int64  `json:"age_ms"`

	RunningReqs float64 `json:"running_reqs"`
	QueuedReqs  float64 `json:"queued_reqs"`
	// TokenUsage is KV cache utilisation, the primary saturation signal.
	// Sustained values above ~0.9 mean the engine is about to start preempting.
	TokenUsage    float64 `json:"token_usage"`
	UsedTokens    float64 `json:"used_tokens"`
	CacheHitRate  float64 `json:"cache_hit_rate"`
	GenThroughput float64 `json:"gen_throughput"`

	// Interval averages derived from histogram sum/count deltas between the
	// last two scrapes. Zero means no completed request in that window.
	TtftMs       float64 `json:"ttft_ms"`
	E2eLatencyMs float64 `json:"e2e_latency_ms"`
	InterTokenMs float64 `json:"inter_token_ms"`
	// QueueTimeMs is how long the engine itself says requests waited before
	// running. The engine measures this directly, so it beats anything the
	// gateway can infer from the outside.
	QueueTimeMs      float64 `json:"queue_time_ms"`
	PromptTokensRate float64 `json:"prompt_tokens_rate"`
	OutputTokensRate float64 `json:"output_tokens_rate"`
}

type target struct {
	channelID   int
	channelName string
	url         string
}

type state struct {
	stats    EngineStats
	prev     map[string]float64
	prevTime time.Time
	scraping bool
}

var (
	mu     sync.RWMutex
	states = map[int]*state{}
	client = &http.Client{Timeout: scrapeTimeout}
)

// Snapshot returns the latest engine stats for every configured channel.
func Snapshot(now time.Time) []EngineStats {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]EngineStats, 0, len(states))
	for _, st := range states {
		s := st.stats
		if s.ScrapedAt > 0 {
			s.AgeMs = now.Sub(time.Unix(s.ScrapedAt, 0)).Milliseconds()
		}
		out = append(out, s)
	}
	return out
}

// Init starts the scrape loop. It is a no-op beyond a sleeping goroutine when
// no channel enables engine metrics.
func Init(logErr func(string)) {
	go func() {
		var (
			targets     []target
			lastRefresh time.Time
		)
		for {
			if time.Since(lastRefresh) >= ChannelRefreshInterval || targets == nil {
				refreshed, err := loadTargets()
				if err != nil {
					if logErr != nil {
						logErr("enginemon: load channels failed: " + err.Error())
					}
				} else {
					targets = refreshed
					pruneStates(targets)
				}
				lastRefresh = time.Now()
			}
			for _, t := range targets {
				scrapeOnce(t)
			}
			time.Sleep(ScrapeInterval)
		}
	}()
}

func loadTargets() ([]target, error) {
	channels, err := model.GetAllChannels(0, 0, true, true)
	if err != nil {
		return nil, err
	}
	targets := make([]target, 0, len(channels))
	for _, ch := range channels {
		setting := ch.GetSetting()
		if !setting.EngineMetricsEnabled {
			continue
		}
		url := strings.TrimSpace(setting.EngineMetricsURL)
		if url == "" {
			base := strings.TrimSpace(ch.GetBaseURL())
			if base == "" {
				continue
			}
			url = strings.TrimSuffix(base, "/") + "/metrics"
		}
		targets = append(targets, target{channelID: ch.Id, channelName: ch.Name, url: url})
	}
	return targets, nil
}

func pruneStates(targets []target) {
	keep := make(map[int]bool, len(targets))
	for _, t := range targets {
		keep[t.channelID] = true
	}
	mu.Lock()
	for id := range states {
		if !keep[id] {
			delete(states, id)
		}
	}
	mu.Unlock()
}

func scrapeOnce(t target) {
	mu.Lock()
	st, ok := states[t.channelID]
	if !ok {
		st = &state{}
		states[t.channelID] = st
	}
	if st.scraping {
		// Previous scrape of this host is still running; skipping keeps a
		// wedged host from accumulating goroutines.
		mu.Unlock()
		return
	}
	st.scraping = true
	mu.Unlock()

	samples, err := fetch(t.url)

	now := time.Now()
	mu.Lock()
	defer mu.Unlock()
	st.scraping = false
	st.stats.ChannelID = t.channelID
	st.stats.ChannelName = t.channelName
	st.stats.URL = t.url
	if err != nil {
		st.stats.Fresh = false
		st.stats.Error = err.Error()
		return
	}
	st.stats.Fresh = true
	st.stats.Error = ""
	st.stats.ScrapedAt = now.Unix()
	st.stats.RunningReqs = samples["num_running_reqs"]
	st.stats.QueuedReqs = samples["num_queue_reqs"]
	st.stats.TokenUsage = kvSaturation(samples)
	st.stats.UsedTokens = samples["num_used_tokens"]
	st.stats.CacheHitRate = samples["cache_hit_rate"]
	st.stats.GenThroughput = samples["gen_throughput"]

	if st.prev != nil {
		elapsed := now.Sub(st.prevTime).Seconds()
		st.stats.TtftMs = histAvgMs(st.prev, samples, "time_to_first_token_seconds")
		st.stats.E2eLatencyMs = histAvgMs(st.prev, samples, "e2e_request_latency_seconds")
		st.stats.InterTokenMs = histAvgMs(st.prev, samples, "inter_token_latency_seconds")
		if st.stats.InterTokenMs == 0 {
			st.stats.InterTokenMs = histAvgMs(st.prev, samples, "time_per_output_token_seconds")
		}
		st.stats.QueueTimeMs = histAvgMs(st.prev, samples, "queue_time_seconds")
		if elapsed > 0 {
			st.stats.PromptTokensRate = counterRate(st.prev, samples, "prompt_tokens_total", elapsed)
			st.stats.OutputTokensRate = counterRate(st.prev, samples, "generation_tokens_total", elapsed)
		}
	}
	st.prev = samples
	st.prevTime = now
}

func fetch(url string) (map[string]float64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), scrapeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseLen))
	if err != nil {
		return nil, err
	}
	return parse(string(body)), nil
}

// kvUsageMetrics are the utilisation gauges a scheduler may publish. Which one
// carries the real number depends on the model's cache layout: a hybrid
// SWA/Mamba model leaves the legacy token_usage at zero and reports through
// full_/swa_/mamba_ instead. The binding constraint is whichever pool fills
// first, so saturation is the maximum across all of them.
var kvUsageMetrics = []string{
	"token_usage",
	"full_token_usage",
	"swa_token_usage",
	"mamba_usage",
}

func kvSaturation(samples map[string]float64) float64 {
	worst := 0.0
	for _, name := range kvUsageMetrics {
		if v, ok := samples[name]; ok && v > worst {
			worst = v
		}
	}
	return worst
}

// ratioMetrics are averaged rather than summed when an engine exposes one
// series per rank: adding utilisation ratios together is meaningless.
var ratioMetrics = map[string]bool{
	"token_usage":      true,
	"full_token_usage": true,
	"swa_token_usage":  true,
	"mamba_usage":      true,
	"cache_hit_rate":   true,
}

// parse reads the Prometheus text exposition format and folds every series of a
// metric into one number. Counts and counters are summed across series, which
// is right for data-parallel workers reporting independent load; ratios take
// the maximum instead.
//
// ponytail: label sets are discarded. If a deployment ever needs per-rank
// breakdown, group by the label string instead of collapsing here.
func parse(body string) map[string]float64 {
	out := map[string]float64{}
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line[0] == '#' {
			continue
		}
		sep := strings.LastIndexByte(line, ' ')
		if sep < 0 {
			continue
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(line[sep+1:]), 64)
		if err != nil {
			continue
		}
		name := strings.TrimSpace(line[:sep])
		if brace := strings.IndexByte(name, '{'); brace >= 0 {
			name = name[:brace]
		}
		name = strings.TrimPrefix(name, "sglang_")
		name = strings.TrimPrefix(name, "sglang:")
		if _, seen := out[name]; seen && ratioMetrics[name] {
			if value > out[name] {
				out[name] = value
			}
			continue
		}
		out[name] += value
	}
	return out
}

// histAvgMs turns a histogram's sum/count delta into the mean over the scrape
// interval. Bucket quantiles are deliberately not parsed: the mean is enough to
// spot a regression, and skipping buckets keeps the parser trivial.
func histAvgMs(prev, cur map[string]float64, base string) float64 {
	dCount := cur[base+"_count"] - prev[base+"_count"]
	dSum := cur[base+"_sum"] - prev[base+"_sum"]
	if dCount <= 0 || dSum < 0 {
		return 0
	}
	return dSum / dCount * 1000
}

func counterRate(prev, cur map[string]float64, name string, elapsed float64) float64 {
	delta := cur[name] - prev[name]
	if delta < 0 {
		// Engine restarted and reset its counters.
		return 0
	}
	return delta / elapsed
}
