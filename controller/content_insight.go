package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 内容洞察查询接口（仅超管路由组挂载）。数据来源是问题表与按天词频聚合表；
// 功能开关关闭时仍可查询已留存的历史数据，前端据 enabled 显示提示。

func contentInsightTimeRange(c *gin.Context) (int64, int64) {
	now := time.Now()
	endTs := now.Unix()
	startTs := now.AddDate(0, 0, -7).Unix()
	if v, err := strconv.ParseInt(c.Query("start_ts"), 10, 64); err == nil && v > 0 {
		startTs = v
	}
	if v, err := strconv.ParseInt(c.Query("end_ts"), 10, 64); err == nil && v > 0 {
		endTs = v
	}
	return startTs, endTs
}

func GetContentInsightTerms(c *gin.Context) {
	startTs, endTs := contentInsightTimeRange(c)
	terms, err := model.GetChatTermStats(startTs, endTs, 300)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled": operation_setting.GetContentInsightSettings().Enabled,
			"terms":   terms,
		},
	})
}

func GetContentInsightQuestions(c *gin.Context) {
	startTs, endTs := contentInsightTimeRange(c)
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	filter := model.ChatQuestionFilter{
		StartTs:   startTs,
		EndTs:     endTs,
		Keyword:   strings.TrimSpace(c.Query("keyword")),
		Username:  strings.TrimSpace(c.Query("username")),
		TokenName: strings.TrimSpace(c.Query("token_name")),
		ModelName: strings.TrimSpace(c.Query("model_name")),
	}
	rows, total, err := model.GetTopChatQuestions(filter, (page-1)*pageSize, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled":   operation_setting.GetContentInsightSettings().Enabled,
			"questions": rows,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}
