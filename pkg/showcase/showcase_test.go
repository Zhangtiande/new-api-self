package showcase

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/enginemon"
	"github.com/QuantumNous/new-api/pkg/livemon"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHistoryCanonicalApplicationsAndPrivateFields(t *testing.T) {
	now := time.Date(2026, 11, 2, 1, 30, 0, 0, showcaseZone)
	bucket := time.Date(2026, 11, 2, 0, 0, 0, 0, showcaseZone).Unix()
	rows := []UsageRow{
		{TokenName: "DIS-PRIVATE_OWNER-MES-Cline-代码辅助", ModelName: "gentis", CreatedAt: bucket, Tokens: 10, Requests: 1},
		{TokenName: "SI3-OTHER_OWNER-Cline_代码辅助", ModelName: "gentis", CreatedAt: bucket, Tokens: 20, Requests: 2},
		{TokenName: "YMSLX-GPT-WEB", ModelName: "gentis-thinking", CreatedAt: bucket + 3600, Tokens: 30, Requests: 3},
		{TokenName: "DIS-owner-10.1.2.3", ModelName: "http://PRIVATE_HOST/model", CreatedAt: bucket, Tokens: 40, Requests: 4},
	}
	history, err := BuildHistory(rows, now)
	require.NoError(t, err)
	require.Len(t, history.Rows, 3)
	assert.Equal(t, "hourly", history.Granularity)
	assert.Equal(t, "2026-10-04", history.FirstDay)
	assert.Equal(t, "2026-11-02", history.LastDay)
	assert.Equal(t, "app:代码辅助", history.Rows[0].ApplicationID)
	assert.Equal(t, int64(30), history.Rows[0].Tokens)
	assert.Equal(t, int64(3), history.Rows[0].Requests)
	assert.Equal(t, "2026-11-02", history.Rows[0].Day)
	assert.Equal(t, "unassigned", history.Rows[1].ApplicationID)
	assert.Equal(t, "Unclassified model", history.Rows[1].Model)
	require.NotNil(t, history.LatestBucket)
	assert.Equal(t, time.Unix(bucket+3600, 0).UTC().Format(time.RFC3339Nano), *history.LatestBucket)
	encoded, err := common.Marshal(history)
	require.NoError(t, err)
	for _, private := range []string{"PRIVATE", "OWNER", "10.1.2.3", "TokenID", "token_id", "department", "username", "channel", "http://"} {
		assert.NotContains(t, string(encoded), private)
	}
}

func TestHistoryEmptyAndInvalidRanges(t *testing.T) {
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	history, err := BuildHistory(nil, now)
	require.NoError(t, err)
	assert.Empty(t, history.Rows)
	assert.NotNil(t, history.Rows)
	assert.Nil(t, history.LatestBucket)
	start, end := HistoryWindow(now)
	for _, row := range []UsageRow{{CreatedAt: start - 1}, {CreatedAt: end}, {CreatedAt: start, Tokens: -1}, {CreatedAt: start, Requests: -1}, {CreatedAt: start, Tokens: maxSafeInteger + 1}} {
		_, err := BuildHistory([]UsageRow{row}, now)
		assert.Error(t, err)
	}
}

func TestApplicationCanonicalNames(t *testing.T) {
	for _, name := range []string{"代码辅助", "Cline_代码辅助", "MES-Cline-代码辅助", "DIS-owner-代码辅助", "SI3-other-MES-Cline-代码辅助"} {
		assert.Equal(t, ApplicationIdentity{ID: "app:代码辅助", Name: "代码辅助"}, ApplicationFromKeyName(name))
	}
	assert.Equal(t, "日计业务 A1", ApplicationFromKeyName("SI3-owner-台湾日计A1-STAGE").Name)
	assert.Equal(t, "OpenClaw", ApplicationFromKeyName("openclaw_10.1.2.3").Name)
	for _, name := range []string{"PRIVATE_PERSON", "DIS-owner-sk-SECRET", "DIS-owner-email@example.com", "DIS-owner-<script>"} {
		assert.Equal(t, "unassigned", ApplicationFromKeyName(name).ID)
	}
}

func TestLiveCompleteAggregatesNeverTruncatedRequestDetails(t *testing.T) {
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	current, err := BuildLive(livemon.Snapshot{Ts: now.Unix(), TotalInFlight: 4, PromptTokens: 300,
		Tokens: []livemon.TokenLive{
			{TokenID: 1234567, TokenName: "DIS-PRIVATE_OWNER-MES-Cline-代码辅助", Username: "PRIVATE_USER", InFlight: 2, Prefilling: 1, PromptTokens: 100, MaxAgeMs: 1000},
			{TokenID: 7654321, TokenName: "SI3-OTHER_OWNER-Cline_代码辅助", InFlight: 2, Prefilling: 0, PromptTokens: 200, MaxAgeMs: 3000},
		}, Models: []livemon.ModelLive{
			{Model: "gentis", InFlight: 2, Generating: 1, Prefilling: 1, PromptTokens: 100, MaxAgeMs: 1000, AvgObservedTtftMs: 100},
			{Model: "gentis", InFlight: 2, Generating: 2, Prefilling: 0, PromptTokens: 200, MaxAgeMs: 3000, AvgObservedTtftMs: 400},
		}, Truncated: true, Requests: []livemon.RequestLive{{RequestID: "PRIVATE_REQUEST", Username: "PRIVATE_USER", Model: "FakeModel"}},
	}, nil, now)
	require.NoError(t, err)
	assert.Equal(t, "available", current.Status)
	assert.Equal(t, 4, current.InFlight)
	assert.Equal(t, 1, current.Prefilling)
	assert.Equal(t, 3, current.Generating)
	assert.Equal(t, 1, current.RecognizedApps)
	assert.Equal(t, 1, current.ActiveModels)
	require.Len(t, current.Applications, 1)
	assert.Equal(t, LiveApplication{ID: "app:代码辅助", Name: "代码辅助", InFlight: 4, Prefilling: 1, PromptTokens: 300, MaxAgeMs: 3000}, current.Applications[0])
	require.Len(t, current.Models, 1)
	require.NotNil(t, current.Models[0].ObservedTTFTMs)
	assert.Equal(t, 300.0, *current.Models[0].ObservedTTFTMs)
	assert.Nil(t, current.OutputTokensPerSecond)
	encoded, err := common.Marshal(current)
	require.NoError(t, err)
	for _, private := range []string{"PRIVATE", "OWNER", "1234567", "7654321", "department", "token_id", "request_id", "username", "FakeModel"} {
		assert.NotContains(t, string(encoded), private)
	}
}

func TestLiveFreshDeduplicatedEngineMetricsAndWeightedCache(t *testing.T) {
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	a := enginemon.EngineStats{URL: "http://10.1.2.3:80/metrics?b=2&a=1", Fresh: true, ScrapedAt: now.Unix() - 1, AgeMs: 1000, RunningReqs: 2, PromptTokensRate: 100, OutputTokensRate: 20, CacheHitTokenRate: .5, TtftMs: 120, InterTokenMs: 20, E2eLatencyMs: 1000, MaxTotalTokens: 1000, KvActiveTokens: 100, KvCachedTokens: 400, KvFreeTokens: 500, ChannelName: "PRIVATE_CHANNEL", ChannelID: 123456}
	older := a
	older.URL, older.ScrapedAt, older.OutputTokensRate = "http://10.1.2.3/metrics?a=1&b=2", now.Unix()-3, 999
	b := enginemon.EngineStats{URL: "http://10.1.2.4/metrics", Fresh: true, ScrapedAt: now.Unix() - 17, AgeMs: 17000, RunningReqs: 0, PromptTokensRate: 300, OutputTokensRate: 30, CacheHitTokenRate: .9, MaxTotalTokens: 2000, KvCachedTokens: 1000, KvFreeTokens: 1000}
	failed := enginemon.EngineStats{URL: "http://10.1.2.5/metrics", Fresh: false, ScrapedAt: now.Unix(), Error: "PRIVATE_ERROR"}
	current, err := BuildLive(livemon.Snapshot{Ts: now.Unix()}, []enginemon.EngineStats{older, failed, b, a}, now)
	require.NoError(t, err)
	require.Len(t, current.Engines, 2)
	assert.Equal(t, 2, current.FreshEngineCount)
	assert.Equal(t, 400.0, *current.InputTokensPerSecond)
	assert.Equal(t, 50.0, *current.OutputTokensPerSecond)
	assert.InDelta(t, .8, *current.CacheReuseRatio, 1e-10)
	assert.Equal(t, 100.0, *current.ActiveTokens)
	assert.Equal(t, 1400.0, *current.CachedTokens)
	assert.Equal(t, 1500.0, *current.FreeTokens)
	assert.Equal(t, 3000.0, *current.CapacityTokens)
	assert.Equal(t, now.Add(18*time.Second).Format(time.RFC3339Nano), current.ValidUntil)
	assert.Equal(t, now.Add(time.Second).Format(time.RFC3339Nano), current.Engines[1].ValidUntil)
	assert.Equal(t, "Inference service 01", current.Engines[0].Name)
	assert.Regexp(t, `^engine-[a-f0-9]{16}$`, current.Engines[0].ID)
	assert.Equal(t, 0.0, *current.Engines[1].RunningRequests)
	assert.Nil(t, current.Engines[1].TTFTMs)
	assert.Equal(t, 0.0, *current.Engines[1].ActiveTokens)
	reordered, err := BuildLive(livemon.Snapshot{Ts: now.Unix()}, []enginemon.EngineStats{a, b, failed, older}, now)
	require.NoError(t, err)
	assert.Equal(t, current.Engines, reordered.Engines)
	afterExpiry, err := BuildLive(livemon.Snapshot{Ts: now.Unix()}, []enginemon.EngineStats{a, b}, now.Add(2*time.Second))
	require.NoError(t, err)
	assert.Equal(t, "available", afterExpiry.Status)
	assert.Equal(t, current.ValidUntil, afterExpiry.ValidUntil)
	require.Len(t, afterExpiry.Engines, 1)
	assert.Equal(t, current.Engines[0].ID, afterExpiry.Engines[0].ID)
	encoded, err := common.Marshal(current)
	require.NoError(t, err)
	for _, private := range []string{"10.1.2", "http", "url", "channel", "PRIVATE", "123456", "queued", "retries"} {
		assert.NotContains(t, string(encoded), private)
	}
}

func TestLiveUnknownZeroAndStaleSources(t *testing.T) {
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	engine := enginemon.EngineStats{URL: "http://engine/metrics", Fresh: true, ScrapedAt: now.Unix() - 1, AgeMs: 1000}
	current, err := BuildLive(livemon.Snapshot{Ts: now.Unix()}, []enginemon.EngineStats{engine}, now)
	require.NoError(t, err)
	assert.Zero(t, current.InFlight)
	assert.Zero(t, current.PromptTokens)
	assert.Nil(t, current.InputTokensPerSecond)
	assert.Nil(t, current.OutputTokensPerSecond)
	assert.Nil(t, current.CacheReuseRatio)
	assert.Nil(t, current.CapacityTokens)
	engine.PromptTokensRate = 100
	current, err = BuildLive(livemon.Snapshot{Ts: now.Unix()}, []enginemon.EngineStats{engine}, now)
	require.NoError(t, err)
	require.NotNil(t, current.OutputTokensPerSecond)
	assert.Zero(t, *current.OutputTokensPerSecond)
	engine.OutputTokensRate = math.Inf(1)
	current, err = BuildLive(livemon.Snapshot{Ts: now.Unix()}, []enginemon.EngineStats{engine}, now)
	require.NoError(t, err)
	assert.Nil(t, current.OutputTokensPerSecond)
	current, err = BuildLive(livemon.Snapshot{Ts: now.Unix() - 18}, []enginemon.EngineStats{engine}, now)
	require.NoError(t, err)
	assert.Equal(t, "stale", current.Status)
	assert.Empty(t, current.Engines)
	assert.Nil(t, current.OutputTokensPerSecond)
	_, err = BuildLive(livemon.Snapshot{Ts: now.Unix(), TotalInFlight: 1, Truncated: true}, nil, now)
	assert.Error(t, err)
}
