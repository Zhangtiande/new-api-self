package common

import (
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const thinkingModelSuffix = "-thinking"

// ApplyThinkingSuffixTemplate 对发往 OpenAI 兼容上游的请求体应用全局思考后缀规则：
// 请求模型名带 -thinking 后缀 → 剥后缀发往上游并合并规则的 on 模板；
// 裸模型名 → 合并 off 模板。在渠道参数覆盖之前执行，渠道级配置仍可覆盖全局规则。
func ApplyThinkingSuffixTemplate(jsonData []byte, info *RelayInfo) ([]byte, error) {
	if info == nil || info.ChannelMeta == nil {
		return jsonData, nil
	}
	setting := model_setting.GetThinkingSuffixSettings()
	if !setting.Enabled {
		return jsonData, nil
	}
	// OpenRouter 有自己的 -thinking 后缀适配；仅处理最终以 OpenAI 格式出站的请求
	if info.ChannelType == constant.ChannelTypeOpenRouter {
		return jsonData, nil
	}
	if info.GetFinalRequestRelayFormat() != types.RelayFormatOpenAI {
		return jsonData, nil
	}

	origin := info.OriginModelName
	isThinking := strings.HasSuffix(origin, thinkingModelSuffix) &&
		!model_setting.ShouldPreserveThinkingSuffix(origin)
	base := origin
	if isThinking {
		base = strings.TrimSuffix(origin, thinkingModelSuffix)
	}

	rule := model_setting.MatchThinkingSuffixRule(base)
	if rule == nil {
		return jsonData, nil
	}

	var err error
	if isThinking {
		// 模型重定向可能已把后缀映射掉；仍带后缀时剥掉再发往上游
		if model := gjson.GetBytes(jsonData, "model"); model.Exists() &&
			strings.HasSuffix(model.String(), thinkingModelSuffix) {
			stripped := strings.TrimSuffix(model.String(), thinkingModelSuffix)
			if jsonData, err = sjson.SetBytes(jsonData, "model", stripped); err != nil {
				return nil, err
			}
			info.UpstreamModelName = stripped
		}
	}

	template := rule.Off
	if isThinking {
		template = rule.On
	}
	return mergeJSONTemplate(jsonData, template, "")
}

// mergeJSONTemplate 把嵌套模板按叶子路径合并进请求体（对象递归、叶子覆盖），
// 保留请求体中模板未涉及的字段。
func mergeJSONTemplate(jsonData []byte, template map[string]interface{}, prefix string) ([]byte, error) {
	var err error
	for key, value := range template {
		path := escapeSjsonLiteralKey(key)
		if prefix != "" {
			path = prefix + "." + path
		}
		if nested, ok := value.(map[string]interface{}); ok {
			if jsonData, err = mergeJSONTemplate(jsonData, nested, path); err != nil {
				return nil, err
			}
			continue
		}
		if jsonData, err = sjson.SetBytes(jsonData, path, value); err != nil {
			return nil, err
		}
	}
	return jsonData, nil
}
