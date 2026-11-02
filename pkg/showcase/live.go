package showcase

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/pkg/enginemon"
	"github.com/QuantumNous/new-api/pkg/livemon"
)

const liveTTL = 18 * time.Second

type LiveApplication struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	InFlight     int    `json:"inFlight"`
	Prefilling   int    `json:"prefilling"`
	PromptTokens int    `json:"promptTokens"`
	MaxAgeMs     int64  `json:"maxAgeMs"`
}

type LiveModel struct {
	ID             string   `json:"id"`
	InFlight       int      `json:"inFlight"`
	Generating     int      `json:"generating"`
	Prefilling     int      `json:"prefilling"`
	PromptTokens   int      `json:"promptTokens"`
	MaxAgeMs       int64    `json:"maxAgeMs"`
	ObservedTTFTMs *float64 `json:"observedTTFTMs"`
}

type LiveEngine struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	AsOf                  string   `json:"asOf"`
	ValidUntil            string   `json:"validUntil"`
	RunningRequests       *float64 `json:"runningRequests"`
	InputTokensPerSecond  *float64 `json:"inputTokensPerSecond"`
	OutputTokensPerSecond *float64 `json:"outputTokensPerSecond"`
	TTFTMs                *float64 `json:"ttftMs"`
	InterTokenMs          *float64 `json:"interTokenMs"`
	E2ELatencyMs          *float64 `json:"e2eLatencyMs"`
	CacheReuseRatio       *float64 `json:"cacheReuseRatio"`
	ActiveTokens          *float64 `json:"activeTokens"`
	CachedTokens          *float64 `json:"cachedTokens"`
	FreeTokens            *float64 `json:"freeTokens"`
	CapacityTokens        *float64 `json:"capacityTokens"`
}

type Live struct {
	AsOf                  string            `json:"asOf"`
	ValidUntil            string            `json:"validUntil"`
	Status                string            `json:"status"`
	SourceType            string            `json:"sourceType"`
	GatewayAvailable      bool              `json:"gatewayAvailable"`
	InFlight              int               `json:"inFlight"`
	PromptTokens          int               `json:"promptTokens"`
	Prefilling            int               `json:"prefilling"`
	ActiveModels          int               `json:"activeModels"`
	Generating            int               `json:"generating"`
	RecognizedApps        int               `json:"recognizedApps"`
	Applications          []LiveApplication `json:"applications"`
	Models                []LiveModel       `json:"models"`
	Engines               []LiveEngine      `json:"engines"`
	FreshEngineCount      int               `json:"freshEngineCount"`
	InputTokensPerSecond  *float64          `json:"inputTokensPerSecond"`
	OutputTokensPerSecond *float64          `json:"outputTokensPerSecond"`
	CacheReuseRatio       *float64          `json:"cacheReuseRatio"`
	ActiveTokens          *float64          `json:"activeTokens"`
	CachedTokens          *float64          `json:"cachedTokens"`
	FreeTokens            *float64          `json:"freeTokens"`
	CapacityTokens        *float64          `json:"capacityTokens"`
}

// BuildLive only reads complete gateway aggregates; the truncated request list
// and all operational identities are deliberately outside the public DTO.
func BuildLive(gateway livemon.Snapshot, sources []enginemon.EngineStats, now time.Time) (*Live, error) {
	if gateway.TotalInFlight < 0 || gateway.PromptTokens < 0 {
		return nil, errors.New("invalid showcase live aggregate")
	}
	asOf := time.Unix(gateway.Ts, 0)
	age := now.Sub(asOf)
	result := &Live{AsOf: asOf.UTC().Format(time.RFC3339Nano), Status: "stale", SourceType: "gateway", GatewayAvailable: true, InFlight: gateway.TotalInFlight, PromptTokens: gateway.PromptTokens, Applications: make([]LiveApplication, 0), Models: make([]LiveModel, 0), Engines: make([]LiveEngine, 0)}
	if age >= -5*time.Second && age < liveTTL {
		result.Status = "available"
	}
	apps := make(map[string]*LiveApplication)
	appTotal := 0
	for _, token := range gateway.Tokens {
		if token.InFlight < 0 || token.Prefilling < 0 || token.Prefilling > token.InFlight || token.PromptTokens < 0 || token.MaxAgeMs < 0 {
			return nil, errors.New("invalid showcase application aggregate")
		}
		identity := ApplicationFromKeyName(token.TokenName)
		app := apps[identity.ID]
		if app == nil {
			app = &LiveApplication{ID: identity.ID, Name: identity.Name}
			apps[identity.ID] = app
		}
		app.InFlight += token.InFlight
		app.Prefilling += token.Prefilling
		app.PromptTokens += token.PromptTokens
		app.MaxAgeMs = max(app.MaxAgeMs, token.MaxAgeMs)
		appTotal += token.InFlight
	}
	for _, app := range apps {
		if app.InFlight > 0 {
			result.Applications = append(result.Applications, *app)
			result.Prefilling += app.Prefilling
			if app.ID != "unassigned" {
				result.RecognizedApps++
			}
		}
	}
	type modelAggregate struct {
		LiveModel
		weightedTTFT float64
		validTTFT    bool
	}
	models := make(map[string]*modelAggregate)
	sourceModels := make(map[string]bool)
	modelTotal := 0
	for _, source := range gateway.Models {
		if source.InFlight < 0 || source.Generating < 0 || source.Prefilling < 0 || source.Generating+source.Prefilling != source.InFlight || source.PromptTokens < 0 || source.MaxAgeMs < 0 {
			return nil, errors.New("invalid showcase model aggregate")
		}
		id := safeModel(source.Model)
		model := models[id]
		if model == nil {
			model = &modelAggregate{LiveModel: LiveModel{ID: id}, validTTFT: true}
			models[id] = model
		}
		model.InFlight += source.InFlight
		model.Generating += source.Generating
		model.Prefilling += source.Prefilling
		model.PromptTokens += source.PromptTokens
		model.MaxAgeMs = max(model.MaxAgeMs, source.MaxAgeMs)
		if source.Generating > 0 {
			model.validTTFT = model.validTTFT && source.AvgObservedTtftMs >= 0
			model.weightedTTFT += float64(source.AvgObservedTtftMs) * float64(source.Generating)
		}
		if source.InFlight > 0 {
			sourceModels[source.Model] = true
		}
		modelTotal += source.InFlight
	}
	for _, model := range models {
		if model.InFlight > 0 {
			if model.Generating > 0 && model.validTTFT {
				model.ObservedTTFTMs = number(model.weightedTTFT / float64(model.Generating))
			}
			result.Models = append(result.Models, model.LiveModel)
			result.Generating += model.Generating
		}
	}
	result.ActiveModels = len(sourceModels)
	if appTotal != gateway.TotalInFlight || modelTotal != gateway.TotalInFlight || result.Generating+result.Prefilling != gateway.TotalInFlight {
		return nil, errors.New("incomplete showcase live aggregate")
	}
	sort.Slice(result.Applications, func(i, j int) bool {
		a, b := result.Applications[i], result.Applications[j]
		if a.InFlight != b.InFlight {
			return a.InFlight > b.InFlight
		}
		return a.ID < b.ID
	})
	sort.Slice(result.Models, func(i, j int) bool {
		a, b := result.Models[i], result.Models[j]
		if a.InFlight != b.InFlight {
			return a.InFlight > b.InFlight
		}
		return a.ID < b.ID
	})
	validUntil := asOf.Add(liveTTL)
	configured := make(map[string]bool)
	fresh := make(map[string]enginemon.EngineStats)
	if result.Status == "available" {
		for _, source := range sources {
			identity := engineIdentity(source.URL)
			if identity == "" {
				continue
			}
			configured[identity] = true
			engineAge := now.Sub(time.Unix(source.ScrapedAt, 0))
			if !source.Fresh || source.ScrapedAt <= 0 || engineAge < -5*time.Second || engineAge >= liveTTL || source.AgeMs < -5000 || source.AgeMs >= liveTTL.Milliseconds() {
				continue
			}
			if previous, ok := fresh[identity]; !ok || previous.ScrapedAt < source.ScrapedAt {
				fresh[identity] = source
			}
		}
	}
	urls := make([]string, 0, len(configured))
	for identity := range configured {
		urls = append(urls, identity)
	}
	sort.Strings(urls)
	for index, identity := range urls {
		source, ok := fresh[identity]
		if !ok {
			continue
		}
		engine := publicEngine(source, identity, index+1)
		result.Engines = append(result.Engines, engine)
	}
	result.ValidUntil = validUntil.UTC().Format(time.RFC3339Nano)
	result.FreshEngineCount = len(result.Engines)
	result.InputTokensPerSecond = engineSum(result.Engines, func(e LiveEngine) *float64 { return e.InputTokensPerSecond })
	result.OutputTokensPerSecond = engineSum(result.Engines, func(e LiveEngine) *float64 { return e.OutputTokensPerSecond })
	result.ActiveTokens = engineSum(result.Engines, func(e LiveEngine) *float64 { return e.ActiveTokens })
	result.CachedTokens = engineSum(result.Engines, func(e LiveEngine) *float64 { return e.CachedTokens })
	result.FreeTokens = engineSum(result.Engines, func(e LiveEngine) *float64 { return e.FreeTokens })
	result.CapacityTokens = engineSum(result.Engines, func(e LiveEngine) *float64 { return e.CapacityTokens })
	weightedReuse, input := 0.0, 0.0
	validReuse := len(result.Engines) > 0
	for _, engine := range result.Engines {
		if engine.InputTokensPerSecond == nil {
			validReuse = false
			continue
		}
		if *engine.InputTokensPerSecond == 0 {
			continue
		}
		if engine.CacheReuseRatio == nil {
			validReuse = false
			continue
		}
		input += *engine.InputTokensPerSecond
		weightedReuse += *engine.InputTokensPerSecond * *engine.CacheReuseRatio
	}
	if validReuse && input > 0 && !math.IsInf(input, 0) {
		result.CacheReuseRatio = number(weightedReuse / input)
	}
	return result, nil
}

func engineIdentity(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if (parsed.Scheme == "http" && port == "80") || (parsed.Scheme == "https" && port == "443") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	parsed.Host, parsed.Fragment, parsed.RawQuery = host, "", parsed.Query().Encode()
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	return parsed.String()
}

func publicEngine(source enginemon.EngineStats, identity string, index int) LiveEngine {
	digest := sha256.Sum256([]byte(identity))
	asOf := time.Unix(source.ScrapedAt, 0)
	deadline := asOf.Add(liveTTL)
	engine := LiveEngine{ID: "engine-" + hex.EncodeToString(digest[:8]), Name: fmt.Sprintf("Inference service %02d", index), AsOf: asOf.UTC().Format(time.RFC3339Nano), ValidUntil: deadline.UTC().Format(time.RFC3339Nano)}
	if math.Trunc(source.RunningReqs) == source.RunningReqs {
		engine.RunningRequests = number(source.RunningReqs)
	}
	intervalObserved := false
	for _, value := range []float64{source.OutputTokensRate, source.PromptTokensRate, source.PrefillComputeRate, source.CacheHitTokenRate, source.EvictionRate, source.TtftMs, source.E2eLatencyMs, source.InterTokenMs, source.QueueTimeMs} {
		intervalObserved = intervalObserved || (value > 0 && number(value) != nil)
	}
	// The source does not distinguish the first sample from an idle interval.
	if source.PromptTokensRate > 0 || intervalObserved {
		engine.InputTokensPerSecond = number(source.PromptTokensRate)
	}
	if source.OutputTokensRate > 0 || intervalObserved {
		engine.OutputTokensPerSecond = number(source.OutputTokensRate)
	}
	if source.TtftMs > 0 {
		engine.TTFTMs = number(source.TtftMs)
	}
	if source.InterTokenMs > 0 {
		engine.InterTokenMs = number(source.InterTokenMs)
	}
	if source.E2eLatencyMs > 0 {
		engine.E2ELatencyMs = number(source.E2eLatencyMs)
	}
	if engine.InputTokensPerSecond != nil && *engine.InputTokensPerSecond > 0 && source.CacheHitTokenRate <= 1 {
		engine.CacheReuseRatio = number(source.CacheHitTokenRate)
	}
	if source.MaxTotalTokens > 0 {
		engine.CapacityTokens = number(source.MaxTotalTokens)
	}
	active, cached, free := number(source.KvActiveTokens), number(source.KvCachedTokens), number(source.KvFreeTokens)
	pool := 0.0
	for _, part := range []*float64{active, cached, free} {
		if part != nil {
			pool += *part
		}
	}
	if engine.CapacityTokens != nil && pool > 0 && pool <= *engine.CapacityTokens {
		engine.ActiveTokens, engine.CachedTokens, engine.FreeTokens = active, cached, free
	}
	return engine
}

func engineSum(engines []LiveEngine, field func(LiveEngine) *float64) *float64 {
	if len(engines) == 0 {
		return nil
	}
	total := 0.0
	for _, engine := range engines {
		value := field(engine)
		if value == nil {
			return nil
		}
		total += *value
	}
	return number(total)
}
