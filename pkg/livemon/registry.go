// Package livemon keeps an in-memory view of the requests this gateway is
// relaying right now. It records nothing to disk and nothing to Redis: the
// historical layer already lives in pkg/perf_metrics, and this package only
// answers "what is happening at this instant".
//
// It depends on the standard library only, because relay/common imports it and
// model imports relay/common.
package livemon

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// MaxEntryAge bounds how long an entry may stay registered. Anything older is
// swept out: a missed Done() would otherwise show up forever as a phantom
// running request, which destroys trust in the panel far faster than it leaks
// memory.
var MaxEntryAge = 30 * time.Minute

// MaxTrackedRequests caps the registry so a pathological burst cannot grow it
// without bound. Past the cap new requests still relay normally, they are just
// not observable in the panel.
const MaxTrackedRequests = 20000

// Entry is one in-flight client request. Fields written after registration are
// atomic because the snapshot goroutine reads them while the relay goroutine
// writes them.
type Entry struct {
	id           uint64
	requestID    string
	model        string
	group        string
	userID       int
	tokenID      int
	isStream     bool
	promptTokens int
	startNano    int64

	channelID      atomic.Int64
	firstTokenNano atomic.Int64
	retries        atomic.Int64
}

// SetChannel records which upstream channel is currently serving this request.
// The relay retry loop can rebind a request to a different channel, so this is
// called once per attempt rather than once per request.
func (e *Entry) SetChannel(channelID int) {
	if e == nil {
		return
	}
	if prev := e.channelID.Swap(int64(channelID)); prev != 0 && prev != int64(channelID) {
		e.retries.Add(1)
	}
}

// MarkFirstToken records the moment the first response byte reached the client.
// Callers invoke it from an already once-guarded branch, so it costs one atomic
// store per request and nothing per token.
func (e *Entry) MarkFirstToken() {
	if e == nil {
		return
	}
	e.firstTokenNano.CompareAndSwap(0, time.Now().UnixNano())
}

var registry = struct {
	mu  sync.RWMutex
	m   map[uint64]*Entry
	seq atomic.Uint64
}{m: make(map[uint64]*Entry)}

// Register adds a request to the live registry. The caller must defer Done on
// the returned entry. A nil entry is valid and every method tolerates it, so
// the caller never needs a nil check.
func Register(requestID, model, group string, userID, tokenID, promptTokens int, isStream bool) *Entry {
	registry.mu.Lock()
	if len(registry.m) >= MaxTrackedRequests {
		registry.mu.Unlock()
		return nil
	}
	e := &Entry{
		id:           registry.seq.Add(1),
		requestID:    requestID,
		model:        model,
		group:        group,
		userID:       userID,
		tokenID:      tokenID,
		isStream:     isStream,
		promptTokens: promptTokens,
		startNano:    time.Now().UnixNano(),
	}
	registry.m[e.id] = e
	registry.mu.Unlock()
	return e
}

// Done removes the request from the registry. It must run even when the relay
// panics, so callers defer it immediately after Register.
func Done(e *Entry) {
	if e == nil {
		return
	}
	registry.mu.Lock()
	delete(registry.m, e.id)
	registry.mu.Unlock()
}

// sweep drops entries that outlived MaxEntryAge, defending the registry against
// any code path that fails to call Done.
func sweep(now time.Time) int {
	cutoff := now.Add(-MaxEntryAge).UnixNano()
	registry.mu.Lock()
	defer registry.mu.Unlock()
	removed := 0
	for id, e := range registry.m {
		if e.startNano < cutoff {
			delete(registry.m, id)
			removed++
		}
	}
	return removed
}

// RequestLive is one in-flight request as shown to an operator.
type RequestLive struct {
	RequestID    string `json:"request_id"`
	Model        string `json:"model"`
	Group        string `json:"group"`
	ChannelID    int    `json:"channel_id"`
	UserID       int    `json:"user_id"`
	TokenID      int    `json:"token_id"`
	AgeMs        int64  `json:"age_ms"`
	TtftMs       int64  `json:"ttft_ms"` // -1 while the request is still in prefill
	PromptTokens int    `json:"prompt_tokens"`
	Retries      int    `json:"retries"`
	IsStream     bool   `json:"is_stream"`
}

// ModelLive aggregates in-flight requests for one model.
type ModelLive struct {
	Model string `json:"model"`
	// InFlight is every request the gateway is currently relaying.
	InFlight int `json:"in_flight"`
	// Prefilling counts requests that have not produced a first token yet.
	// A rising number here is the earliest visible sign of upstream queueing.
	Prefilling int `json:"prefilling"`
	// Generating counts requests already streaming tokens back.
	Generating        int   `json:"generating"`
	MaxAgeMs          int64 `json:"max_age_ms"`
	PromptTokens      int   `json:"prompt_tokens"`
	AvgObservedTtftMs int64 `json:"avg_observed_ttft_ms"`
}

// ChannelLive aggregates in-flight requests for one upstream channel.
type ChannelLive struct {
	ChannelID  int `json:"channel_id"`
	InFlight   int `json:"in_flight"`
	Prefilling int `json:"prefilling"`
}

// Snapshot is a consistent view of the registry at one instant.
type Snapshot struct {
	Ts            int64         `json:"ts"`
	TotalInFlight int           `json:"total_in_flight"`
	Models        []ModelLive   `json:"models"`
	Channels      []ChannelLive `json:"channels"`
	// Requests holds the longest-running requests, the entry point for
	// "who is holding the GPU right now".
	Requests  []RequestLive `json:"requests"`
	Truncated bool          `json:"truncated"`
}

// TopRequests bounds how many individual in-flight requests a snapshot carries.
const TopRequests = 50

// Take builds a snapshot of the registry. It holds the read lock only long
// enough to copy scalars out; all aggregation happens on the copy.
func Take(now time.Time) Snapshot {
	nowNano := now.UnixNano()

	registry.mu.RLock()
	rows := make([]RequestLive, 0, len(registry.m))
	for _, e := range registry.m {
		ttft := int64(-1)
		if ft := e.firstTokenNano.Load(); ft != 0 {
			ttft = (ft - e.startNano) / int64(time.Millisecond)
		}
		rows = append(rows, RequestLive{
			RequestID:    e.requestID,
			Model:        e.model,
			Group:        e.group,
			ChannelID:    int(e.channelID.Load()),
			UserID:       e.userID,
			TokenID:      e.tokenID,
			AgeMs:        (nowNano - e.startNano) / int64(time.Millisecond),
			TtftMs:       ttft,
			PromptTokens: e.promptTokens,
			Retries:      int(e.retries.Load()),
			IsStream:     e.isStream,
		})
	}
	registry.mu.RUnlock()

	byModel := map[string]*ModelLive{}
	ttftSum := map[string]int64{}
	ttftCount := map[string]int64{}
	byChannel := map[int]*ChannelLive{}
	for _, r := range rows {
		m, ok := byModel[r.Model]
		if !ok {
			m = &ModelLive{Model: r.Model}
			byModel[r.Model] = m
		}
		m.InFlight++
		m.PromptTokens += r.PromptTokens
		if r.AgeMs > m.MaxAgeMs {
			m.MaxAgeMs = r.AgeMs
		}
		if r.TtftMs < 0 {
			m.Prefilling++
		} else {
			m.Generating++
			ttftSum[r.Model] += r.TtftMs
			ttftCount[r.Model]++
		}

		ch, ok := byChannel[r.ChannelID]
		if !ok {
			ch = &ChannelLive{ChannelID: r.ChannelID}
			byChannel[r.ChannelID] = ch
		}
		ch.InFlight++
		if r.TtftMs < 0 {
			ch.Prefilling++
		}
	}

	snap := Snapshot{
		Ts:            now.Unix(),
		TotalInFlight: len(rows),
		Models:        make([]ModelLive, 0, len(byModel)),
		Channels:      make([]ChannelLive, 0, len(byChannel)),
	}
	for name, m := range byModel {
		if n := ttftCount[name]; n > 0 {
			m.AvgObservedTtftMs = ttftSum[name] / n
		}
		snap.Models = append(snap.Models, *m)
	}
	for _, ch := range byChannel {
		snap.Channels = append(snap.Channels, *ch)
	}
	sort.Slice(snap.Models, func(i, j int) bool { return snap.Models[i].InFlight > snap.Models[j].InFlight })
	sort.Slice(snap.Channels, func(i, j int) bool { return snap.Channels[i].InFlight > snap.Channels[j].InFlight })

	sort.Slice(rows, func(i, j int) bool { return rows[i].AgeMs > rows[j].AgeMs })
	if len(rows) > TopRequests {
		rows = rows[:TopRequests]
		snap.Truncated = true
	}
	snap.Requests = rows
	return snap
}
