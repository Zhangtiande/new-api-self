package showcase

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLifetimeIncludesAllDatesAndModelsWithoutExposingIdentities(t *testing.T) {
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	first := time.Date(2024, 12, 30, 16, 0, 0, 0, time.UTC).Unix()
	rows := []LifetimeUsageRow{
		{TokenName: "DIS-PRIVATE_OWNER-代码辅助", ModelName: "gentis", FirstAt: first, LastAt: now.Unix() - 3600, Tokens: 100, Requests: 1},
		{TokenName: "SI3-OTHER_OWNER-MES-Cline-代码辅助", ModelName: "gentis-thinking", FirstAt: first + 86400, LastAt: now.Unix(), Tokens: 200, Requests: 2},
		{TokenName: "DIS-PRIVATE_OWNER-A1-Gentis", ModelName: "qwen3-coder", FirstAt: first + 86400, LastAt: now.Unix(), Tokens: 300, Requests: 3},
		{TokenName: "unrecognized-PRIVATE_OWNER", ModelName: "", FirstAt: first + 86400, LastAt: now.Unix(), Tokens: 400, Requests: 4},
		{TokenName: "DIS-owner-10.1.2.3", ModelName: "http://PRIVATE_MODEL", FirstAt: first + 86400, LastAt: now.Unix(), Tokens: 50, Requests: 1},
	}
	lifetime, err := BuildLifetime(rows, now)
	require.NoError(t, err)
	assert.EqualValues(t, 1050, lifetime.Tokens)
	assert.EqualValues(t, 11, lifetime.Requests)
	assert.Equal(t, 2, lifetime.Applications)
	assert.Equal(t, 4, lifetime.Models)
	require.NotNil(t, lifetime.FirstDay)
	require.NotNil(t, lifetime.LastDay)
	assert.Equal(t, "2024-12-31", *lifetime.FirstDay)
	assert.Equal(t, "2026-11-02", *lifetime.LastDay)
	encoded, err := common.Marshal(lifetime)
	require.NoError(t, err)
	for _, private := range []string{"PRIVATE", "OWNER", "qwen3-coder", "gentis", "token_id", "name", "10.1.2.3", "http"} {
		assert.NotContains(t, string(encoded), private)
	}
}

func TestLifetimeEmptyAndInvalidValues(t *testing.T) {
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	lifetime, err := BuildLifetime(nil, now)
	require.NoError(t, err)
	assert.Equal(t, &Lifetime{AsOf: now.Format(time.RFC3339Nano)}, lifetime)
	encoded, err := common.Marshal(lifetime)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"firstDay":null`)
	assert.Contains(t, string(encoded), `"lastDay":null`)
	for _, rows := range [][]LifetimeUsageRow{
		{{FirstAt: -1}},
		{{FirstAt: 1, LastAt: 0}},
		{{LastAt: now.Unix() + 1}},
		{{Tokens: -1}},
		{{Requests: -1}},
		{{Tokens: maxSafeInteger}, {Tokens: 1}},
		{{Requests: maxSafeInteger}, {Requests: 1}},
	} {
		_, err := BuildLifetime(rows, now)
		assert.Error(t, err)
	}
}
