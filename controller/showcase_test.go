package controller

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShowcaseHistoryCacheCoalescesAndExpires(t *testing.T) {
	cache := &showcaseHistoryCache{}
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	var calls atomic.Int32
	var lifetimeCalls atomic.Int32
	query := func(start, end int64) ([]model.ShowcaseUsageRow, error) {
		calls.Add(1)
		return []model.ShowcaseUsageRow{{TokenName: "YMSLX-GPT-WEB", ModelName: "gentis", CreatedAt: start, Tokens: 10, Requests: 1}}, nil
	}
	queryLifetime := func(end int64) ([]model.ShowcaseLifetimeUsageRow, error) {
		lifetimeCalls.Add(1)
		return []model.ShowcaseLifetimeUsageRow{{TokenName: "YMSLX-GPT-WEB", ModelName: "gentis", FirstAt: now.AddDate(-1, 0, 0).Unix(), LastAt: now.Unix(), Tokens: 100, Requests: 20}}, nil
	}
	var ready sync.WaitGroup
	ready.Add(4)
	for range 4 {
		go func() {
			defer ready.Done()
			_, err := cache.load(now, query, queryLifetime)
			assert.NoError(t, err)
		}()
	}
	ready.Wait()
	assert.Equal(t, int32(1), calls.Load())
	assert.Equal(t, int32(1), lifetimeCalls.Load())
	first, err := cache.load(now.Add(4*time.Minute), query, queryLifetime)
	require.NoError(t, err)
	assert.Equal(t, now.UTC().Format(time.RFC3339Nano), first.Snapshot.AsOf)
	assert.Equal(t, int64(100), first.Lifetime.Tokens)
	assert.Equal(t, int64(10), first.Snapshot.Rows[0].Tokens)
	assert.Equal(t, "2025-11-02", *first.Lifetime.FirstDay)
	_, err = cache.load(now.Add(5*time.Minute), query, queryLifetime)
	require.NoError(t, err)
	assert.Equal(t, int32(2), calls.Load())
	assert.Equal(t, int32(2), lifetimeCalls.Load())
}

func TestShowcaseHistoryCacheDoesNotCacheFailuresOrYesterday(t *testing.T) {
	cache := &showcaseHistoryCache{}
	now := time.Date(2026, 11, 2, 15, 59, 0, 0, time.UTC)
	queryLifetime := func(int64) ([]model.ShowcaseLifetimeUsageRow, error) { return nil, nil }
	_, err := cache.load(now, func(int64, int64) ([]model.ShowcaseUsageRow, error) {
		return nil, errors.New("private database failure")
	}, queryLifetime)
	require.Error(t, err)
	query := func(int64, int64) ([]model.ShowcaseUsageRow, error) { return nil, nil }
	first, err := cache.load(now, query, queryLifetime)
	require.NoError(t, err)
	assert.Equal(t, "2026-11-02", first.Snapshot.LastDay)
	next, err := cache.load(now.Add(time.Minute), query, queryLifetime)
	require.NoError(t, err)
	assert.Equal(t, "2026-11-03", next.Snapshot.LastDay)
}

func TestShowcaseLifetimeFailureDoesNotReplaceSuccessfulCache(t *testing.T) {
	cache := &showcaseHistoryCache{}
	now := time.Date(2026, 11, 2, 4, 30, 0, 0, time.UTC)
	query := func(int64, int64) ([]model.ShowcaseUsageRow, error) { return nil, nil }
	queryLifetime := func(int64) ([]model.ShowcaseLifetimeUsageRow, error) { return nil, nil }
	first, err := cache.load(now, query, queryLifetime)
	require.NoError(t, err)
	_, err = cache.load(now.Add(5*time.Minute), query, func(int64) ([]model.ShowcaseLifetimeUsageRow, error) { return nil, errors.New("temporary failure") })
	require.Error(t, err)
	assert.Same(t, first, cache.value)
	next, err := cache.load(now.Add(5*time.Minute), query, queryLifetime)
	require.NoError(t, err)
	assert.NotSame(t, first, next)
}
