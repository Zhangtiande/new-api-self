package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// 内容洞察：采集每次对话请求的“第一条 user 消息”（截断文本）用于
// 词云、高频问题与关键词检索。默认关闭；开启属于留存员工提问原文，
// 需要在组织内部完成告知。仅超管可见相关数据接口。
type ContentInsightSettings struct {
	Enabled       bool `json:"enabled"`
	RetentionDays int  `json:"retention_days"` // 问题原文保留天数，0 表示不自动清理
}

var contentInsightSettings = ContentInsightSettings{
	Enabled:       false,
	RetentionDays: 90,
}

func init() {
	config.GlobalConfig.Register("content_insight", &contentInsightSettings)
}

func GetContentInsightSettings() *ContentInsightSettings {
	return &contentInsightSettings
}
