package controller

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/enginemon"
	"github.com/QuantumNous/new-api/pkg/livemon"
	"github.com/QuantumNous/new-api/pkg/showcase"
	"github.com/gin-gonic/gin"
)

type showcaseHistoryCache struct {
	mu      sync.Mutex
	value   *showcaseOverview
	expires time.Time
}

type showcaseOverview struct {
	Snapshot *showcase.History  `json:"snapshot"`
	Lifetime *showcase.Lifetime `json:"lifetime"`
}

var showcaseHistory showcaseHistoryCache

func (cache *showcaseHistoryCache) load(now time.Time, query func(int64, int64) ([]model.ShowcaseUsageRow, error), queryLifetime func(int64) ([]model.ShowcaseLifetimeUsageRow, error)) (*showcaseOverview, error) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	_, end := showcase.HistoryWindow(now)
	localDay := time.Unix(end-1, 0).In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	if cache.value != nil && now.Before(cache.expires) && cache.value.Snapshot.LastDay == localDay {
		return cache.value, nil
	}
	start, end := showcase.HistoryWindow(now)
	rows, err := query(start, end)
	if err != nil {
		return nil, err
	}
	usage := make([]showcase.UsageRow, 0, len(rows))
	for _, row := range rows {
		usage = append(usage, showcase.UsageRow{TokenName: row.TokenName, ModelName: row.ModelName, CreatedAt: row.CreatedAt, Tokens: row.Tokens, Requests: row.Requests})
	}
	snapshot, err := showcase.BuildHistory(usage, now)
	if err != nil {
		return nil, err
	}
	lifetimeRows, err := queryLifetime(end)
	if err != nil {
		return nil, err
	}
	lifetimeUsage := make([]showcase.LifetimeUsageRow, 0, len(lifetimeRows))
	for _, row := range lifetimeRows {
		lifetimeUsage = append(lifetimeUsage, showcase.LifetimeUsageRow{TokenName: row.TokenName, ModelName: row.ModelName, FirstAt: row.FirstAt, LastAt: row.LastAt, Tokens: row.Tokens, Requests: row.Requests})
	}
	lifetime, err := showcase.BuildLifetime(lifetimeUsage, now)
	if err != nil {
		return nil, err
	}
	value := &showcaseOverview{Snapshot: snapshot, Lifetime: lifetime}
	cache.value, cache.expires = value, now.Add(5*time.Minute)
	return value, nil
}

func GetShowcase(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	value, err := showcaseHistory.load(time.Now(), func(start, end int64) ([]model.ShowcaseUsageRow, error) {
		return model.QueryShowcaseUsage(model.DB.WithContext(ctx), start, end)
	}, func(end int64) ([]model.ShowcaseLifetimeUsageRow, error) {
		return model.QueryShowcaseLifetimeUsage(model.DB.WithContext(ctx), end)
	})
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Showcase data is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": value})
}

func GetShowcaseLive(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	now := time.Now()
	current, err := showcase.BuildLive(livemon.Take(now), enginemon.Snapshot(now), now)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Live showcase data is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"current": current}})
}
