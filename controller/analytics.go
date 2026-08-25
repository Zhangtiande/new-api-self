package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// 月度经营分析报告：一次返回目标月与上一个月的固定口径聚合结果，
// 数字全部由后端计算，前端/AI 只负责呈现与解读，避免口径漂移。

type analyticsPeriodReport struct {
	StartTs  int64                          `json:"start_ts"`
	EndTs    int64                          `json:"end_ts"`
	Overview model.AnalyticsOverview        `json:"overview"`
	Daily    []model.AnalyticsDailyStat     `json:"daily"`
	Models   []model.AnalyticsDimensionStat `json:"models"`
	Apps     []model.AnalyticsDimensionStat `json:"apps"`
	Channels []model.AnalyticsChannelPerf   `json:"channels"`
}

type monthlyAnalyticsReport struct {
	Month     string                `json:"month"`
	PrevMonth string                `json:"prev_month"`
	Current   analyticsPeriodReport `json:"current"`
	Previous  analyticsPeriodReport `json:"previous"`
}

func buildAnalyticsPeriodReport(startTs, endTs int64, channelIds []int, tzOffset int64, channelNames map[int]string) (analyticsPeriodReport, error) {
	report := analyticsPeriodReport{StartTs: startTs, EndTs: endTs}

	overview, err := model.GetAnalyticsOverview(startTs, endTs)
	if err != nil {
		return report, err
	}
	report.Overview = overview

	if report.Daily, err = model.GetAnalyticsDaily(startTs, endTs, tzOffset); err != nil {
		return report, err
	}
	if report.Models, err = model.GetAnalyticsByDimension(startTs, endTs, "model_name"); err != nil {
		return report, err
	}
	if report.Apps, err = model.GetAnalyticsByDimension(startTs, endTs, "token_name"); err != nil {
		return report, err
	}

	for _, channelId := range channelIds {
		perf, err := model.GetAnalyticsChannelPerf(startTs, endTs, channelId, tzOffset)
		if err != nil {
			return report, err
		}
		perf.ChannelName = channelNames[channelId]
		report.Channels = append(report.Channels, perf)
	}
	return report, nil
}

func GetMonthlyAnalyticsReport(c *gin.Context) {
	loc := time.Local
	now := time.Now().In(loc)

	monthParam := strings.TrimSpace(c.Query("month"))
	var monthStart time.Time
	if monthParam == "" {
		// 默认统计上个月整月
		firstOfThisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		monthStart = firstOfThisMonth.AddDate(0, -1, 0)
	} else {
		parsed, err := time.ParseInLocation("2006-01", monthParam, loc)
		if err != nil {
			common.ApiErrorMsg(c, "month 参数格式应为 YYYY-MM")
			return
		}
		monthStart = parsed
	}
	monthEnd := monthStart.AddDate(0, 1, 0)
	prevStart := monthStart.AddDate(0, -1, 0)

	_, tzOffsetInt := monthStart.Zone()
	tzOffset := int64(tzOffsetInt)

	var channelIds []int
	if channelsParam := strings.TrimSpace(c.Query("channels")); channelsParam != "" {
		for _, part := range strings.Split(channelsParam, ",") {
			id, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil || id <= 0 {
				common.ApiErrorMsg(c, "channels 参数应为逗号分隔的渠道 ID")
				return
			}
			channelIds = append(channelIds, id)
		}
	} else {
		ids, err := model.GetAnalyticsChannelIds(monthStart.Unix(), monthEnd.Unix())
		if err != nil {
			common.ApiError(c, err)
			return
		}
		channelIds = ids
	}

	channelNames := make(map[int]string, len(channelIds))
	for _, id := range channelIds {
		if channel, err := model.GetChannelById(id, false); err == nil && channel != nil {
			channelNames[id] = channel.Name
		} else {
			channelNames[id] = fmt.Sprintf("渠道 %d", id)
		}
	}

	current, err := buildAnalyticsPeriodReport(monthStart.Unix(), monthEnd.Unix(), channelIds, tzOffset, channelNames)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	previous, err := buildAnalyticsPeriodReport(prevStart.Unix(), monthStart.Unix(), channelIds, tzOffset, channelNames)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": monthlyAnalyticsReport{
			Month:     monthStart.Format("2006-01"),
			PrevMonth: prevStart.Format("2006-01"),
			Current:   current,
			Previous:  previous,
		},
	})
}
