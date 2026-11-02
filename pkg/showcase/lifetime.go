package showcase

import (
	"errors"
	"strings"
	"time"
)

type LifetimeUsageRow struct {
	TokenName string
	ModelName string
	FirstAt   int64
	LastAt    int64
	Tokens    int64
	Requests  int64
}

type Lifetime struct {
	AsOf         string  `json:"asOf"`
	FirstDay     *string `json:"firstDay"`
	LastDay      *string `json:"lastDay"`
	Tokens       int64   `json:"tokens"`
	Requests     int64   `json:"requests"`
	Applications int     `json:"applications"`
	Models       int     `json:"models"`
}

func BuildLifetime(rows []LifetimeUsageRow, now time.Time) (*Lifetime, error) {
	lifetime := &Lifetime{AsOf: now.UTC().Format(time.RFC3339Nano)}
	applications, models := make(map[string]bool), make(map[string]bool)
	var firstAt, lastAt int64
	for index, row := range rows {
		if row.Tokens < 0 || row.Requests < 0 || row.FirstAt < 0 || row.LastAt < row.FirstAt || row.LastAt > now.Unix() {
			return nil, errors.New("invalid showcase lifetime aggregate")
		}
		if row.Tokens > maxSafeInteger-lifetime.Tokens || row.Requests > maxSafeInteger-lifetime.Requests {
			return nil, errors.New("showcase lifetime exceeds safe numeric range")
		}
		lifetime.Tokens += row.Tokens
		lifetime.Requests += row.Requests
		if app := ApplicationFromKeyName(row.TokenName); app.ID != "unassigned" {
			applications[app.ID] = true
		}
		// Count actual identities without exposing their names or merging thinking variants.
		if model := strings.TrimSpace(row.ModelName); model != "" {
			models[model] = true
		}
		if index == 0 || row.FirstAt < firstAt {
			firstAt = row.FirstAt
		}
		lastAt = max(lastAt, row.LastAt)
	}
	lifetime.Applications, lifetime.Models = len(applications), len(models)
	if len(rows) > 0 {
		first := time.Unix(firstAt, 0).In(showcaseZone).Format("2006-01-02")
		last := time.Unix(lastAt, 0).In(showcaseZone).Format("2006-01-02")
		lifetime.FirstDay, lifetime.LastDay = &first, &last
	}
	return lifetime, nil
}
