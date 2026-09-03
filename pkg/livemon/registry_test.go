package livemon

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetRegistry(t *testing.T) {
	t.Helper()
	registry.mu.Lock()
	registry.m = map[uint64]*Entry{}
	registry.mu.Unlock()
}

func TestRegisterAndDoneLifecycle(t *testing.T) {
	resetRegistry(t)

	e := Register("req-1", "qwen3-32b", "default", 7, 3, 1200, true)
	require.NotNil(t, e)

	snap := Take(time.Now())
	require.Equal(t, 1, snap.TotalInFlight)
	require.Len(t, snap.Models, 1)
	assert.Equal(t, "qwen3-32b", snap.Models[0].Model)
	assert.Equal(t, 1, snap.Models[0].Prefilling, "a request with no first token yet must count as prefilling")
	assert.Equal(t, 0, snap.Models[0].Generating)
	assert.Equal(t, 1200, snap.Models[0].PromptTokens)

	Done(e)
	assert.Equal(t, 0, Take(time.Now()).TotalInFlight)
}

func TestMarkFirstTokenMovesRequestToGenerating(t *testing.T) {
	resetRegistry(t)
	e := Register("req-1", "qwen3-32b", "default", 7, 3, 10, true)
	defer Done(e)

	e.MarkFirstToken()
	first := e.firstTokenNano.Load()
	require.NotZero(t, first)

	// Marking again must not move the timestamp: TTFT is a once-per-request
	// fact and the streaming path calls into this repeatedly.
	e.MarkFirstToken()
	assert.Equal(t, first, e.firstTokenNano.Load())

	snap := Take(time.Now())
	require.Len(t, snap.Models, 1)
	assert.Equal(t, 0, snap.Models[0].Prefilling)
	assert.Equal(t, 1, snap.Models[0].Generating)
	require.Len(t, snap.Requests, 1)
	assert.GreaterOrEqual(t, snap.Requests[0].TtftMs, int64(0))
}

func TestSetChannelCountsRetriesNotFirstBind(t *testing.T) {
	resetRegistry(t)
	e := Register("req-1", "qwen3-32b", "default", 7, 3, 10, false)
	defer Done(e)

	e.SetChannel(4)
	assert.Zero(t, e.retries.Load(), "first channel bind is not a retry")

	e.SetChannel(4)
	assert.Zero(t, e.retries.Load(), "rebinding the same channel is not a retry")

	e.SetChannel(5)
	assert.Equal(t, int64(1), e.retries.Load())

	snap := Take(time.Now())
	require.Len(t, snap.Requests, 1)
	assert.Equal(t, 5, snap.Requests[0].ChannelID)
	assert.Equal(t, 1, snap.Requests[0].Retries)
}

// A missed Done would otherwise leave a phantom running request on the panel
// forever. The age sweep is the backstop that makes that impossible.
func TestSweepReclaimsLeakedEntries(t *testing.T) {
	resetRegistry(t)
	leaked := Register("leaked", "qwen3-32b", "default", 1, 1, 10, false)
	require.NotNil(t, leaked)
	live := Register("live", "qwen3-32b", "default", 1, 1, 10, false)
	defer Done(live)

	leaked.startNano = time.Now().Add(-2 * MaxEntryAge).UnixNano()

	assert.Equal(t, 1, sweep(time.Now()))
	snap := Take(time.Now())
	assert.Equal(t, 1, snap.TotalInFlight)
	require.Len(t, snap.Requests, 1)
	assert.Equal(t, "live", snap.Requests[0].RequestID)
}

func TestRegisterRefusesPastCap(t *testing.T) {
	resetRegistry(t)
	original := MaxTrackedRequests
	_ = original

	registry.mu.Lock()
	for i := 0; i < MaxTrackedRequests; i++ {
		id := registry.seq.Add(1)
		registry.m[id] = &Entry{id: id, startNano: time.Now().UnixNano()}
	}
	registry.mu.Unlock()

	assert.Nil(t, Register("overflow", "m", "g", 1, 1, 1, false),
		"past the cap the request must still relay, it is only unobservable")
	resetRegistry(t)
}

// Nil entries are the documented "not tracked" state, so every method has to
// tolerate them without a nil check at the call site in the relay hot path.
func TestNilEntryMethodsAreSafe(t *testing.T) {
	var e *Entry
	assert.NotPanics(t, func() {
		e.SetChannel(1)
		e.MarkFirstToken()
		Done(e)
	})
}

func TestConcurrentRegisterDoneAndSnapshot(t *testing.T) {
	resetRegistry(t)
	var wg sync.WaitGroup
	stop := make(chan struct{})

	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				Take(time.Now())
			}
		}
	}()

	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				e := Register("r", "qwen3-32b", "default", 1, 1, 5, true)
				e.SetChannel(4)
				e.MarkFirstToken()
				Done(e)
			}
		}()
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	time.Sleep(50 * time.Millisecond)
	close(stop)
	<-done

	assert.Equal(t, 0, Take(time.Now()).TotalInFlight, "every registered request must be released")
}

func BenchmarkRegisterDone(b *testing.B) {
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			e := Register("req", "qwen3-32b", "default", 1, 1, 1000, true)
			e.SetChannel(4)
			e.MarkFirstToken()
			Done(e)
		}
	})
}

func BenchmarkTakeWith500InFlight(b *testing.B) {
	registry.mu.Lock()
	registry.m = map[uint64]*Entry{}
	registry.mu.Unlock()
	for i := 0; i < 500; i++ {
		e := Register("req", "qwen3-32b", "default", 1, 1, 1000, true)
		e.SetChannel(4)
		if i%2 == 0 {
			e.MarkFirstToken()
		}
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		Take(time.Now())
	}
}
