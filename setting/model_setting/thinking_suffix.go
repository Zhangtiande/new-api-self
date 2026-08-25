package model_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// ThinkingSuffixRule 定义一条按模型前缀匹配的思考开关注入规则。
// 请求模型名带 `-thinking` 后缀时向请求体合并 On 模板（并剥掉后缀发往上游），
// 裸模型名合并 Off 模板。模板是任意 JSON 合并补丁，
// 例如 {"chat_template_kwargs": {"enable_thinking": true}}。
type ThinkingSuffixRule struct {
	Match string                 `json:"match"`
	On    map[string]interface{} `json:"on,omitempty"`
	Off   map[string]interface{} `json:"off,omitempty"`
}

// ThinkingSuffixSettings OpenAI 兼容渠道的思考后缀适配（面向 sglang/vLLM 等自部署引擎）。
type ThinkingSuffixSettings struct {
	Enabled bool                 `json:"enabled"`
	Rules   []ThinkingSuffixRule `json:"rules"`
}

var defaultThinkingSuffixSettings = ThinkingSuffixSettings{
	Enabled: false,
	Rules:   []ThinkingSuffixRule{},
}

var thinkingSuffixSettings = defaultThinkingSuffixSettings

func init() {
	config.GlobalConfig.Register("thinking_suffix", &thinkingSuffixSettings)
}

func GetThinkingSuffixSettings() *ThinkingSuffixSettings {
	return &thinkingSuffixSettings
}

// MatchThinkingSuffixRule 按最长前缀匹配规则；baseModel 是已剥掉 -thinking 后缀的模型名。
func MatchThinkingSuffixRule(baseModel string) *ThinkingSuffixRule {
	baseModel = strings.TrimSpace(baseModel)
	if baseModel == "" {
		return nil
	}
	var best *ThinkingSuffixRule
	bestLen := -1
	for i := range thinkingSuffixSettings.Rules {
		rule := &thinkingSuffixSettings.Rules[i]
		match := strings.TrimSpace(rule.Match)
		if match == "" || !strings.HasPrefix(baseModel, match) {
			continue
		}
		if len(match) > bestLen {
			best = rule
			bestLen = len(match)
		}
	}
	return best
}
