package enginemon

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Real sglang exposition output, trimmed to the series the panel consumes.
const sglangSample = `# HELP sglang_num_running_reqs The number of running requests.
# TYPE sglang_num_running_reqs gauge
sglang_num_running_reqs{model_name="Qwen3-32B",engine_type="unified",tp_rank="0",pp_rank="0",dp_rank="0"} 3.0
# HELP sglang_num_queue_reqs The number of requests in the waiting queue.
# TYPE sglang_num_queue_reqs gauge
sglang_num_queue_reqs{model_name="Qwen3-32B",engine_type="unified",tp_rank="0",pp_rank="0",dp_rank="0"} 7.0
# HELP sglang_token_usage The token usage.
# TYPE sglang_token_usage gauge
sglang_token_usage{model_name="Qwen3-32B",engine_type="unified",tp_rank="0",pp_rank="0",dp_rank="0"} 0.94
# HELP sglang_cache_hit_rate The prefix cache hit rate.
# TYPE sglang_cache_hit_rate gauge
sglang_cache_hit_rate{model_name="Qwen3-32B",engine_type="unified",tp_rank="0",pp_rank="0",dp_rank="0"} 0.62
# HELP sglang_gen_throughput The generation throughput (token/s).
# TYPE sglang_gen_throughput gauge
sglang_gen_throughput{model_name="Qwen3-32B",engine_type="unified",tp_rank="0",pp_rank="0",dp_rank="0"} 412.5
# HELP sglang_num_used_tokens The number of used tokens.
# TYPE sglang_num_used_tokens gauge
sglang_num_used_tokens{model_name="Qwen3-32B",engine_type="unified",tp_rank="0",pp_rank="0",dp_rank="0"} 48000.0
# HELP sglang_prompt_tokens_total Number of prefill tokens processed.
# TYPE sglang_prompt_tokens_total counter
sglang_prompt_tokens_total{model_name="Qwen3-32B"} 1000.0
# HELP sglang_generation_tokens_total Number of generation tokens processed.
# TYPE sglang_generation_tokens_total counter
sglang_generation_tokens_total{model_name="Qwen3-32B"} 500.0
# HELP sglang_time_to_first_token_seconds Histogram of time to first token.
# TYPE sglang_time_to_first_token_seconds histogram
sglang_time_to_first_token_seconds_sum{model_name="Qwen3-32B"} 20.0
sglang_time_to_first_token_seconds_count{model_name="Qwen3-32B"} 100.0
sglang_time_to_first_token_seconds_bucket{model_name="Qwen3-32B",le="0.1"} 12.0
`

func TestParseSglangExposition(t *testing.T) {
	got := parse(sglangSample)

	assert.Equal(t, 3.0, got["num_running_reqs"])
	assert.Equal(t, 7.0, got["num_queue_reqs"])
	assert.Equal(t, 0.94, got["token_usage"])
	assert.Equal(t, 0.62, got["cache_hit_rate"])
	assert.Equal(t, 412.5, got["gen_throughput"])
	assert.Equal(t, 48000.0, got["num_used_tokens"])
	assert.Equal(t, 20.0, got["time_to_first_token_seconds_sum"])
	assert.Equal(t, 100.0, got["time_to_first_token_seconds_count"])
}

// v0.5.4 renamed the prefix from "sglang:" to "sglang_". Accepting both costs
// one line and keeps the panel working against an older engine.
func TestParseAcceptsLegacyColonPrefix(t *testing.T) {
	got := parse(`sglang:num_running_reqs{model_name="m"} 5.0`)
	assert.Equal(t, 5.0, got["num_running_reqs"])
}

func TestParseFoldsSeriesCountsAddRatiosDoNot(t *testing.T) {
	// Two data-parallel workers each reporting their own load.
	body := `sglang_num_running_reqs{dp_rank="0"} 3.0
sglang_num_running_reqs{dp_rank="1"} 4.0
sglang_token_usage{dp_rank="0"} 0.5
sglang_token_usage{dp_rank="1"} 0.9
`
	got := parse(body)
	assert.Equal(t, 7.0, got["num_running_reqs"], "request counts across workers are additive")
	assert.Equal(t, 0.9, got["token_usage"], "utilisation ratios must never be summed")
}

func TestParseIgnoresCommentsAndMalformedLines(t *testing.T) {
	got := parse("# HELP x y\n\nsglang_num_running_reqs not_a_number\nsglang_num_queue_reqs{a=\"b\"} 2.0\n")
	_, running := got["num_running_reqs"]
	assert.False(t, running, "a non-numeric value must be skipped, not coerced to zero")
	assert.Equal(t, 2.0, got["num_queue_reqs"])
}

func TestHistAvgMsUsesIntervalDelta(t *testing.T) {
	prev := map[string]float64{"ttft_sum": 10.0, "ttft_count": 100.0}
	cur := map[string]float64{"ttft_sum": 12.0, "ttft_count": 110.0}
	// 2s spread over 10 newly completed requests = 200ms mean for the window.
	assert.InDelta(t, 200.0, histAvgMs(prev, cur, "ttft"), 1e-9)
}

func TestHistAvgMsReturnsZeroWithoutCompletedRequests(t *testing.T) {
	same := map[string]float64{"ttft_sum": 10.0, "ttft_count": 100.0}
	assert.Zero(t, histAvgMs(same, same, "ttft"))
}

func TestCounterRateHandlesEngineRestart(t *testing.T) {
	prev := map[string]float64{"generation_tokens_total": 900.0}
	cur := map[string]float64{"generation_tokens_total": 1900.0}
	assert.InDelta(t, 200.0, counterRate(prev, cur, "generation_tokens_total", 5.0), 1e-9)

	// After a restart the counter resets; a negative delta must not surface as
	// a negative throughput.
	restarted := map[string]float64{"generation_tokens_total": 12.0}
	assert.Zero(t, counterRate(prev, restarted, "generation_tokens_total", 5.0))
}

func TestScrapeTimeoutStaysBelowInterval(t *testing.T) {
	require.Less(t, scrapeTimeout, ScrapeInterval,
		"a scrape must not be able to outlive its own interval and stack up")
}
