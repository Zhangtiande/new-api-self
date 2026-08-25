package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAnalyticsPercentile(t *testing.T) {
	tests := []struct {
		name   string
		values []float64
		p      float64
		want   float64
	}{
		{name: "empty returns zero", values: nil, p: 0.5, want: 0},
		{name: "single value", values: []float64{42}, p: 0.95, want: 42},
		{name: "median of odd count", values: []float64{1, 2, 3, 4, 5}, p: 0.5, want: 3},
		{name: "median of even count nearest rank", values: []float64{1, 2, 3, 4}, p: 0.5, want: 2},
		{name: "p95 of hundred values", values: seq100(), p: 0.95, want: 95},
		{name: "p95 small sample", values: []float64{10, 20, 30}, p: 0.95, want: 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, analyticsPercentile(tt.values, tt.p))
		})
	}
}

func seq100() []float64 {
	values := make([]float64, 100)
	for i := range values {
		values[i] = float64(i + 1)
	}
	return values
}

func TestLatencyStatsFrom(t *testing.T) {
	stats := latencyStatsFrom([]float64{300, 100, 200})
	require.Equal(t, 3, stats.Count)
	assert.Equal(t, float64(200), stats.P50)
	assert.Equal(t, float64(300), stats.P95)

	empty := latencyStatsFrom(nil)
	assert.Equal(t, LatencyStats{}, empty)
}

func TestAnalyticsDayStart(t *testing.T) {
	cst := time.FixedZone("CST", 8*3600)
	// 2026-07-15 03:30:00 +08:00 应归到 2026-07-15 00:00:00 +08:00
	ts := time.Date(2026, 7, 15, 3, 30, 0, 0, cst).Unix()
	wantDayStart := time.Date(2026, 7, 15, 0, 0, 0, 0, cst).Unix()
	assert.Equal(t, wantDayStart, analyticsDayStart(ts, 8*3600))

	// 边界：本地 0 点整
	assert.Equal(t, wantDayStart, analyticsDayStart(wantDayStart, 8*3600))

	// UTC 时区（偏移 0）
	utcTs := time.Date(2026, 7, 15, 23, 59, 59, 0, time.UTC).Unix()
	wantUtcDay := time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC).Unix()
	assert.Equal(t, wantUtcDay, analyticsDayStart(utcTs, 0))
}
