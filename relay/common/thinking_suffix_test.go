package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func withThinkingSuffixSettings(t *testing.T, settings model_setting.ThinkingSuffixSettings) {
	t.Helper()
	current := model_setting.GetThinkingSuffixSettings()
	saved := *current
	*current = settings
	t.Cleanup(func() { *current = saved })
}

func thinkingSuffixTestInfo(originModel string, channelType int) *RelayInfo {
	return &RelayInfo{
		OriginModelName: originModel,
		RelayFormat:     types.RelayFormatOpenAI,
		ChannelMeta: &ChannelMeta{
			ChannelType:       channelType,
			UpstreamModelName: originModel,
		},
	}
}

func TestApplyThinkingSuffixTemplate(t *testing.T) {
	rules := []model_setting.ThinkingSuffixRule{
		{
			Match: "qwen3",
			On:    map[string]interface{}{"chat_template_kwargs": map[string]interface{}{"enable_thinking": true}},
			Off:   map[string]interface{}{"chat_template_kwargs": map[string]interface{}{"enable_thinking": false}},
		},
		{
			Match: "glm",
			On:    map[string]interface{}{"chat_template_kwargs": map[string]interface{}{"thinking": true}},
			Off:   map[string]interface{}{"chat_template_kwargs": map[string]interface{}{"thinking": false}},
		},
	}

	t.Run("disabled leaves body unchanged", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: false, Rules: rules})
		info := thinkingSuffixTestInfo("qwen3-32b-thinking", constant.ChannelTypeOpenAI)
		body := []byte(`{"model":"qwen3-32b-thinking","messages":[]}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, string(body), string(result))
	})

	t.Run("thinking suffix strips model and merges on template", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("qwen3-32b-thinking", constant.ChannelTypeOpenAI)
		body := []byte(`{"model":"qwen3-32b-thinking","messages":[],"chat_template_kwargs":{"foo":"bar"}}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, "qwen3-32b", gjson.GetBytes(result, "model").String())
		assert.True(t, gjson.GetBytes(result, "chat_template_kwargs.enable_thinking").Bool())
		// 模板未涉及的 kwargs 字段保留
		assert.Equal(t, "bar", gjson.GetBytes(result, "chat_template_kwargs.foo").String())
		assert.Equal(t, "qwen3-32b", info.UpstreamModelName)
	})

	t.Run("bare model merges off template", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("qwen3-32b", constant.ChannelTypeOpenAI)
		body := []byte(`{"model":"qwen3-32b","messages":[]}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, "qwen3-32b", gjson.GetBytes(result, "model").String())
		enable := gjson.GetBytes(result, "chat_template_kwargs.enable_thinking")
		require.True(t, enable.Exists())
		assert.False(t, enable.Bool())
	})

	t.Run("longest prefix rule wins per model family", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("glm-4.7-thinking", constant.ChannelTypeOpenAI)
		body := []byte(`{"model":"glm-4.7-thinking","messages":[]}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, "glm-4.7", gjson.GetBytes(result, "model").String())
		assert.True(t, gjson.GetBytes(result, "chat_template_kwargs.thinking").Bool())
		assert.False(t, gjson.GetBytes(result, "chat_template_kwargs.enable_thinking").Exists())
	})

	t.Run("model mapping already stripped suffix still applies template", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("qwen3-32b-thinking", constant.ChannelTypeOpenAI)
		// 渠道模型重定向已把 body 里的模型映射为裸名
		body := []byte(`{"model":"qwen3-32b","messages":[]}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, "qwen3-32b", gjson.GetBytes(result, "model").String())
		assert.True(t, gjson.GetBytes(result, "chat_template_kwargs.enable_thinking").Bool())
	})

	t.Run("no matching rule leaves body unchanged", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("gpt-4o", constant.ChannelTypeOpenAI)
		body := []byte(`{"model":"gpt-4o","messages":[]}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, string(body), string(result))
	})

	t.Run("openrouter channel is excluded", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("qwen3-32b-thinking", constant.ChannelTypeOpenRouter)
		body := []byte(`{"model":"qwen3-32b-thinking","messages":[]}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, string(body), string(result))
	})

	t.Run("non openai final format is excluded", func(t *testing.T) {
		withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{Enabled: true, Rules: rules})
		info := thinkingSuffixTestInfo("qwen3-32b-thinking", constant.ChannelTypeOpenAI)
		info.RelayFormat = types.RelayFormatClaude
		body := []byte(`{"model":"qwen3-32b-thinking"}`)
		result, err := ApplyThinkingSuffixTemplate(body, info)
		require.NoError(t, err)
		assert.Equal(t, string(body), string(result))
	})
}

func TestMatchThinkingSuffixRuleLongestPrefix(t *testing.T) {
	withThinkingSuffixSettings(t, model_setting.ThinkingSuffixSettings{
		Enabled: true,
		Rules: []model_setting.ThinkingSuffixRule{
			{Match: "qwen3"},
			{Match: "qwen3-32b"},
			{Match: ""},
		},
	})
	rule := model_setting.MatchThinkingSuffixRule("qwen3-32b")
	require.NotNil(t, rule)
	assert.Equal(t, "qwen3-32b", rule.Match)

	assert.Nil(t, model_setting.MatchThinkingSuffixRule("deepseek-v3"))
	assert.Nil(t, model_setting.MatchThinkingSuffixRule(""))
}
