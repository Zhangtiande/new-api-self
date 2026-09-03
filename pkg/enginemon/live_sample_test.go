package enginemon

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// liveSample mirrors the exposition a production sglang server actually
// returns (tensor parallel 4, hybrid SWA cache). Values are synthetic but every
// structural quirk that broke the first implementation is reproduced exactly:
// the "sglang:" colon prefix, config gauges duplicated per tp_rank while
// scheduler gauges appear on rank 0 only, histograms and counters split by
// is_streaming, and scientific-notation values.
func liveSample(t *testing.T) map[string]float64 {
	t.Helper()
	body, err := os.ReadFile("testdata/sglang_live_sample.txt")
	require.NoError(t, err)
	return parse(string(body))
}

// The scheduler publishes state gauges from rank 0 only, so folding must not
// multiply them by the tensor-parallel width.
func TestLiveSampleSchedulerGaugesAreNotMultipliedByTpRank(t *testing.T) {
	got := liveSample(t)
	// The sample caught one request in flight on a tp=4 engine. Folding must
	// report 1, not 4.
	assert.Equal(t, 1.0, got["num_running_reqs"])
	assert.Equal(t, 0.0, got["num_queue_reqs"])
	assert.Equal(t, 20000.0, got["num_used_tokens"], "single rank-0 series must pass through unscaled")
	assert.Equal(t, 4e6, got["max_total_num_tokens"], "config gauges really are repeated on every rank")
}

// The regression that matters most: on a hybrid SWA model the legacy
// token_usage gauge stays pinned at 0 while the cache really is in use. Reading
// it alone would leave the saturation indicator permanently green.
func TestLiveSampleSaturationIgnoresTheDeadTokenUsageGauge(t *testing.T) {
	got := liveSample(t)
	require.Equal(t, 0.0, got["token_usage"], "fixture must keep the dead gauge, that is the point")
	require.Greater(t, got["full_token_usage"], 0.0)

	// Saturation follows whichever pool is fullest, never the legacy gauge.
	assert.InDelta(t, 0.81, kvSaturation(got), 1e-9)
}

func TestKvSaturationTakesTheFullestPool(t *testing.T) {
	assert.InDelta(t, 0.91, kvSaturation(map[string]float64{
		"token_usage":      0.0,
		"full_token_usage": 0.42,
		"swa_token_usage":  0.91,
		"mamba_usage":      0.10,
	}), 1e-9)

	// A plain non-SWA model reports through the legacy gauge only.
	assert.InDelta(t, 0.77, kvSaturation(map[string]float64{"token_usage": 0.77}), 1e-9)
	assert.Zero(t, kvSaturation(map[string]float64{}))
}

// Histograms are split by is_streaming. Summing sums and counts separately
// yields the correct pooled mean across both request kinds.
func TestLiveSampleHistogramsPoolAcrossStreamingSplit(t *testing.T) {
	got := liveSample(t)
	assert.InDelta(t, 200.0+40.0, got["time_to_first_token_seconds_sum"], 1e-6)
	assert.InDelta(t, 100.0+20.0, got["time_to_first_token_seconds_count"], 1e-9)

	prev := map[string]float64{
		"time_to_first_token_seconds_sum":   got["time_to_first_token_seconds_sum"] - 3.0,
		"time_to_first_token_seconds_count": got["time_to_first_token_seconds_count"] - 2.0,
	}
	assert.InDelta(t, 1500.0, histAvgMs(prev, got, "time_to_first_token_seconds"), 1e-9)
}

// The engine names this inter_token_latency_seconds, not the
// time_per_output_token_seconds the docs suggested.
func TestLiveSampleExposesInterTokenLatencyUnderItsRealName(t *testing.T) {
	got := liveSample(t)
	assert.Greater(t, got["inter_token_latency_seconds_count"], 0.0)
	_, legacy := got["time_per_output_token_seconds_count"]
	assert.False(t, legacy, "fixture must not accidentally satisfy the old name")
}

// Queue time is reported per rank with identical counts, so the pooled mean
// still equals the per-rank mean.
func TestLiveSampleQueueTimePoolsToPerRankMean(t *testing.T) {
	got := liveSample(t)
	prev := map[string]float64{
		"queue_time_seconds_sum":   got["queue_time_seconds_sum"] - 4*0.5,
		"queue_time_seconds_count": got["queue_time_seconds_count"] - 4*1.0,
	}
	assert.InDelta(t, 500.0, histAvgMs(prev, got, "queue_time_seconds"), 1e-9)
}
