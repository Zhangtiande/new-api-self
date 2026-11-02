package model

import (
	"errors"
	"sort"

	"gorm.io/gorm"
)

// ShowcaseUsageRow is an internal aggregate. It must never be sent as an API DTO.
type ShowcaseUsageRow struct {
	TokenID   int    `json:"-"`
	TokenName string `json:"-" gorm:"-"`
	ModelName string `json:"-"`
	CreatedAt int64  `json:"-"`
	Tokens    int64  `json:"-"`
	Requests  int64  `json:"-"`
}

type ShowcaseLifetimeUsageRow struct {
	TokenID   int    `json:"-"`
	TokenName string `json:"-" gorm:"-"`
	ModelName string `json:"-"`
	FirstAt   int64  `json:"-"`
	LastAt    int64  `json:"-"`
	Tokens    int64  `json:"-"`
	Requests  int64  `json:"-"`
}

func GetShowcaseUsage(start, end int64) ([]ShowcaseUsageRow, error) {
	return QueryShowcaseUsage(DB, start, end)
}

// QueryShowcaseUsage only reads hourly usage and the application-bearing names;
// no token secret, owner, user, channel, or log record is selected.
func QueryShowcaseUsage(db *gorm.DB, start, end int64) ([]ShowcaseUsageRow, error) {
	if db == nil || start < 0 || end < start {
		return nil, errors.New("invalid showcase usage range")
	}
	rows := make([]ShowcaseUsageRow, 0)
	if err := db.Table("quota_data").
		Select("token_id, model_name, created_at, SUM(token_used) AS tokens, SUM(count) AS requests").
		Where("created_at >= ? AND created_at < ?", start, end).
		Group("token_id, model_name, created_at").
		Order("created_at, token_id, model_name").Limit(100001).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) > 100000 {
		return nil, errors.New("showcase usage exceeds complete aggregation limit")
	}
	ids := make([]int, 0)
	for _, row := range rows {
		if row.Tokens < 0 || row.Requests < 0 {
			return nil, errors.New("invalid showcase usage values")
		}
		ids = append(ids, row.TokenID)
	}
	names, err := loadShowcaseTokenNames(db, ids)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].TokenName = names[rows[i].TokenID]
	}
	return rows, nil
}

// QueryShowcaseLifetimeUsage has no lower date bound and retains all model identities.
func QueryShowcaseLifetimeUsage(db *gorm.DB, end int64) ([]ShowcaseLifetimeUsageRow, error) {
	if db == nil || end < 0 {
		return nil, errors.New("invalid showcase lifetime range")
	}
	rows := make([]ShowcaseLifetimeUsageRow, 0)
	if err := db.Table("quota_data").
		Select("token_id, model_name, SUM(token_used) AS tokens, SUM(count) AS requests, MIN(created_at) AS first_at, MAX(created_at) AS last_at").
		Where("created_at < ?", end).
		Group("token_id, model_name").
		Order("token_id, model_name").Limit(100001).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) > 100000 {
		return nil, errors.New("showcase lifetime exceeds complete aggregation limit")
	}
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		if row.Tokens < 0 || row.Requests < 0 || row.FirstAt < 0 || row.LastAt < row.FirstAt {
			return nil, errors.New("invalid showcase lifetime values")
		}
		ids = append(ids, row.TokenID)
	}
	names, err := loadShowcaseTokenNames(db, ids)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].TokenName = names[rows[i].TokenID]
	}
	return rows, nil
}

func loadShowcaseTokenNames(db *gorm.DB, tokenIDs []int) (map[int]string, error) {
	ids := make([]int, 0, len(tokenIDs))
	seen := make(map[int]bool)
	for _, id := range tokenIDs {
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	names := make(map[int]string)
	for offset := 0; offset < len(ids); offset += 500 {
		endOffset := min(offset+500, len(ids))
		var tokens []struct {
			ID   int
			Name string
		}
		if err := db.Model(&Token{}).Select("id, name").Where("id IN ?", ids[offset:endOffset]).Scan(&tokens).Error; err != nil {
			return nil, err
		}
		for _, token := range tokens {
			names[token.ID] = token.Name
		}
	}
	return names, nil
}
