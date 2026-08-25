package model

import (
	"database/sql"
	"sort"

	"github.com/tidwall/gjson"
)

// 月度经营分析报告的聚合查询。所有数字由代码按固定口径计算，
// 保证跨期结论口径一致：
//   - 只统计消费日志（type = LogTypeConsume），时间基于 created_at；
//   - 时延指标剔除空值/非正值/明显无效值后，取中位数与 P95；
//   - 按天分桶使用服务器本地时区的自然日。

type AnalyticsOverview struct {
	RequestCount     int64 `json:"request_count"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	Quota            int64 `json:"quota"`
}

type AnalyticsDimensionStat struct {
	Name             string `json:"name"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	Quota            int64  `json:"quota"`
}

type AnalyticsDailyStat struct {
	DayTs            int64 `json:"day_ts"`
	RequestCount     int64 `json:"request_count"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	Quota            int64 `json:"quota"`
}

type LatencyStats struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
}

type AnalyticsChannelDaily struct {
	DayTs   int64        `json:"day_ts"`
	Frt     LatencyStats `json:"frt_ms"`
	UseTime LatencyStats `json:"use_time_s"`
}

type AnalyticsChannelPerf struct {
	ChannelId    int                     `json:"channel_id"`
	ChannelName  string                  `json:"channel_name"`
	RequestCount int64                   `json:"request_count"`
	Frt          LatencyStats            `json:"frt_ms"`
	UseTime      LatencyStats            `json:"use_time_s"`
	Daily        []AnalyticsChannelDaily `json:"daily"`
}

// 时延指标的无效值上界：首字时延超过 1 小时、完成时长超过 24 小时视为脏数据剔除。
const (
	analyticsMaxFrtMs      = float64(3600 * 1000)
	analyticsMaxUseTimeSec = float64(86400)
)

// analyticsDayStart 把时间戳按给定时区偏移归到本地自然日 0 点（返回 UTC 时间戳）。
func analyticsDayStart(ts int64, tzOffsetSeconds int64) int64 {
	return ts - ((ts + tzOffsetSeconds) % 86400)
}

// analyticsDayExpr 与 analyticsDayStart 语义一致的 SQL 表达式。
// 整数取模在 MySQL/PostgreSQL/SQLite 上行为一致，避免使用各库互不兼容的日期函数。
const analyticsDayExpr = "created_at - ((created_at + ?) % 86400)"

// analyticsPercentile 按最近秩法取分位数，values 必须已升序排序。
func analyticsPercentile(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	idx := int(float64(n)*p+0.5) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= n {
		idx = n - 1
	}
	return sorted[idx]
}

func latencyStatsFrom(values []float64) LatencyStats {
	if len(values) == 0 {
		return LatencyStats{}
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	return LatencyStats{
		Count: len(sorted),
		P50:   analyticsPercentile(sorted, 0.5),
		P95:   analyticsPercentile(sorted, 0.95),
	}
}

func GetAnalyticsOverview(startTs, endTs int64) (AnalyticsOverview, error) {
	var overview AnalyticsOverview
	err := LOG_DB.Table("logs").
		Select("count(*) as request_count, COALESCE(sum(prompt_tokens), 0) as prompt_tokens, COALESCE(sum(completion_tokens), 0) as completion_tokens, COALESCE(sum(quota), 0) as quota").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, startTs, endTs).
		Scan(&overview).Error
	return overview, err
}

// GetAnalyticsByDimension 按模型或应用（token_name）聚合。
// column 只允许内部调用方传入固定列名，不接受用户输入。
func GetAnalyticsByDimension(startTs, endTs int64, column string) ([]AnalyticsDimensionStat, error) {
	var stats []AnalyticsDimensionStat
	err := LOG_DB.Table("logs").
		Select(column+" as name, count(*) as request_count, COALESCE(sum(prompt_tokens), 0) as prompt_tokens, COALESCE(sum(completion_tokens), 0) as completion_tokens, COALESCE(sum(quota), 0) as quota").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, startTs, endTs).
		Group(column).
		// ONLY_FULL_GROUP_BY 下别名表达式会被解析成裸列，必须直接写聚合表达式
		Order("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) DESC").
		Limit(100).
		Scan(&stats).Error
	return stats, err
}

func GetAnalyticsDaily(startTs, endTs int64, tzOffsetSeconds int64) ([]AnalyticsDailyStat, error) {
	var stats []AnalyticsDailyStat
	err := LOG_DB.Table("logs").
		Select(analyticsDayExpr+" as day_ts, count(*) as request_count, COALESCE(sum(prompt_tokens), 0) as prompt_tokens, COALESCE(sum(completion_tokens), 0) as completion_tokens, COALESCE(sum(quota), 0) as quota", tzOffsetSeconds).
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, startTs, endTs).
		Group("day_ts").
		Order("day_ts ASC").
		Scan(&stats).Error
	return stats, err
}

// GetAnalyticsChannelIds 返回统计期内按请求量排序的渠道 ID（用于未显式指定渠道时）。
func GetAnalyticsChannelIds(startTs, endTs int64) ([]int, error) {
	var rows []struct {
		ChannelId    int   `json:"channel_id"`
		RequestCount int64 `json:"request_count"`
	}
	err := LOG_DB.Table("logs").
		Select("channel_id, count(*) as request_count").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, startTs, endTs).
		Group("channel_id").
		Order("request_count DESC").
		Limit(20).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		if row.ChannelId > 0 {
			ids = append(ids, row.ChannelId)
		}
	}
	return ids, nil
}

// GetAnalyticsChannelPerf 流式扫描单个渠道当期的消费日志，在 Go 侧计算
// 首字时延（logs.other 里的 frt，毫秒）与完成时长（use_time，秒）的中位数/P95。
// MySQL 5.7 及 SQLite 没有跨库一致的分位数函数，Go 侧计算是唯一可移植口径。
// ponytail: 单渠道单月全量扫描，内存只保留数值切片；日志量到千万级/月时再引入月度聚合表。
func GetAnalyticsChannelPerf(startTs, endTs int64, channelId int, tzOffsetSeconds int64) (AnalyticsChannelPerf, error) {
	perf := AnalyticsChannelPerf{ChannelId: channelId}

	rows, err := LOG_DB.Table("logs").
		Select("created_at, use_time, other").
		Where("type = ? AND channel_id = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, channelId, startTs, endTs).
		Rows()
	if err != nil {
		return perf, err
	}
	defer rows.Close()

	var frtAll, useTimeAll []float64
	frtByDay := make(map[int64][]float64)
	useTimeByDay := make(map[int64][]float64)

	for rows.Next() {
		var createdAt int64
		var useTime sql.NullInt64
		var other sql.NullString
		if err := rows.Scan(&createdAt, &useTime, &other); err != nil {
			return perf, err
		}
		perf.RequestCount++
		day := analyticsDayStart(createdAt, tzOffsetSeconds)

		if useTime.Valid {
			ut := float64(useTime.Int64)
			if ut > 0 && ut <= analyticsMaxUseTimeSec {
				useTimeAll = append(useTimeAll, ut)
				useTimeByDay[day] = append(useTimeByDay[day], ut)
			}
		}
		if other.Valid && other.String != "" {
			frt := gjson.Get(other.String, "frt").Float()
			if frt > 0 && frt <= analyticsMaxFrtMs {
				frtAll = append(frtAll, frt)
				frtByDay[day] = append(frtByDay[day], frt)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return perf, err
	}

	perf.Frt = latencyStatsFrom(frtAll)
	perf.UseTime = latencyStatsFrom(useTimeAll)

	daySet := make(map[int64]struct{}, len(frtByDay)+len(useTimeByDay))
	for day := range frtByDay {
		daySet[day] = struct{}{}
	}
	for day := range useTimeByDay {
		daySet[day] = struct{}{}
	}
	days := make([]int64, 0, len(daySet))
	for day := range daySet {
		days = append(days, day)
	}
	sort.Slice(days, func(i, j int) bool { return days[i] < days[j] })
	for _, day := range days {
		perf.Daily = append(perf.Daily, AnalyticsChannelDaily{
			DayTs:   day,
			Frt:     latencyStatsFrom(frtByDay[day]),
			UseTime: latencyStatsFrom(useTimeByDay[day]),
		})
	}
	return perf, nil
}
