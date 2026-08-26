package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 内容洞察数据表（日志库）。只保留每次请求“第一条 user 消息”的截断文本，
// 不保存完整对话与响应。同一对话多轮重发时问题哈希相同，查询端按哈希去重。
// ClickHouse 日志库暂不支持（表结构走 GORM AutoMigrate）。

type ChatQuestion struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index:idx_chat_question_created_at"`
	UserId       int    `json:"user_id" gorm:"index"`
	Username     string `json:"username" gorm:"index;default:''"`
	TokenName    string `json:"token_name" gorm:"default:''"`
	ModelName    string `json:"model_name" gorm:"default:''"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64);default:''"`
	QuestionHash string `json:"question_hash" gorm:"type:varchar(64);index:idx_chat_question_hash"`
	Question     string `json:"question" gorm:"type:text"`
}

// ChatTermStat 按天聚合的词频（服务器本地自然日）。由后台任务全量重算写入。
type ChatTermStat struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	DayTs     int64  `json:"day_ts" gorm:"bigint;index:idx_chat_term_day"`
	Term      string `json:"term" gorm:"type:varchar(64)"`
	TermCount int64  `json:"count" gorm:"column:term_count"`
}

func contentInsightStorageReady() bool {
	return !common.UsingLogDatabase(common.DatabaseTypeClickHouse)
}

// recordChatQuestion 消费日志落库后写入问题表；仅当功能开启且中转入口
// 提取到问题文本时写入，失败只记日志不影响主流程。
func recordChatQuestion(c *gin.Context, userId int, params RecordConsumeLogParams, username, requestId string, createdAt int64) {
	if !operation_setting.GetContentInsightSettings().Enabled || !contentInsightStorageReady() {
		return
	}
	hash := common.GetContextKeyString(c, constant.ContextKeyChatQuestionHash)
	if hash == "" {
		return
	}
	question := &ChatQuestion{
		CreatedAt:    createdAt,
		UserId:       userId,
		Username:     username,
		TokenName:    params.TokenName,
		ModelName:    params.ModelName,
		RequestId:    requestId,
		QuestionHash: hash,
		Question:     common.GetContextKeyString(c, constant.ContextKeyChatQuestion),
	}
	if err := LOG_DB.Create(question).Error; err != nil {
		logger.LogError(c, "failed to record chat question: "+err.Error())
	}
}

type ChatTermCount struct {
	Term  string `json:"term"`
	Count int64  `json:"count"`
}

// GetChatTermStats 汇总时间范围内的词频（按天聚合表求和）。
func GetChatTermStats(startTs, endTs int64, limit int) ([]ChatTermCount, error) {
	var rows []ChatTermCount
	err := LOG_DB.Model(&ChatTermStat{}).
		Select("term, SUM(term_count) as count").
		Where("day_ts >= ? AND day_ts < ?", startTs, endTs).
		Group("term").
		// ONLY_FULL_GROUP_BY 下必须直接写聚合表达式
		Order("SUM(term_count) DESC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

type ChatQuestionGroup struct {
	QuestionHash string `json:"question_hash"`
	Question     string `json:"question"`
	Count        int64  `json:"count"`
	LastAt       int64  `json:"last_at"`
}

type ChatQuestionFilter struct {
	StartTs   int64
	EndTs     int64
	Keyword   string
	Username  string
	TokenName string
	ModelName string
}

func (f ChatQuestionFilter) apply() *gorm.DB {
	query := LOG_DB.Model(&ChatQuestion{}).
		Where("created_at >= ? AND created_at < ?", f.StartTs, f.EndTs)
	if f.Keyword != "" {
		query = query.Where("question LIKE ?", "%"+f.Keyword+"%")
	}
	if f.Username != "" {
		query = query.Where("username = ?", f.Username)
	}
	if f.TokenName != "" {
		query = query.Where("token_name = ?", f.TokenName)
	}
	if f.ModelName != "" {
		query = query.Where("model_name = ?", f.ModelName)
	}
	return query
}

// GetTopChatQuestions 按问题哈希去重的高频问题列表（一次对话计一次）。
func GetTopChatQuestions(filter ChatQuestionFilter, offset, limit int) ([]ChatQuestionGroup, int64, error) {
	var total int64
	if err := filter.apply().Distinct("question_hash").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []ChatQuestionGroup
	err := filter.apply().
		Select("question_hash, MAX(question) as question, COUNT(*) as count, MAX(created_at) as last_at").
		Group("question_hash").
		// ONLY_FULL_GROUP_BY 下必须直接写聚合表达式
		Order("COUNT(*) DESC").
		Offset(offset).
		Limit(limit).
		Scan(&rows).Error
	return rows, total, err
}

// GetDistinctChatQuestionsBetween 返回时间范围内按哈希去重后的问题文本，
// 供分词聚合任务使用。
func GetDistinctChatQuestionsBetween(startTs, endTs int64) ([]string, error) {
	var questions []string
	err := LOG_DB.Model(&ChatQuestion{}).
		Where("created_at >= ? AND created_at < ?", startTs, endTs).
		Group("question_hash").
		Pluck("MAX(question)", &questions).Error
	return questions, err
}

// ReplaceChatTermStatsForDay 全量替换某天的词频聚合。
func ReplaceChatTermStatsForDay(dayTs int64, stats []ChatTermCount) error {
	return LOG_DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("day_ts = ?", dayTs).Delete(&ChatTermStat{}).Error; err != nil {
			return err
		}
		if len(stats) == 0 {
			return nil
		}
		rows := make([]ChatTermStat, 0, len(stats))
		for _, s := range stats {
			rows = append(rows, ChatTermStat{DayTs: dayTs, Term: s.Term, TermCount: s.Count})
		}
		return tx.CreateInBatches(rows, 200).Error
	})
}

// PurgeChatQuestionsBefore 按保留期清理问题原文。
func PurgeChatQuestionsBefore(cutoffTs int64) (int64, error) {
	result := LOG_DB.Where("created_at < ?", cutoffTs).Delete(&ChatQuestion{})
	return result.RowsAffected, result.Error
}
