package common

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractChatQuestion(t *testing.T) {
	t.Run("first user message string content", func(t *testing.T) {
		question, hash := ExtractChatQuestion([]dto.Message{
			{Role: "system", Content: "you are helpful"},
			{Role: "user", Content: "怎么部署服务"},
			{Role: "assistant", Content: "如下"},
			{Role: "user", Content: "继续"},
		})
		assert.Equal(t, "怎么部署服务", question)
		require.NotEmpty(t, hash)
		assert.Len(t, hash, 32)
	})

	t.Run("array content extracts text parts", func(t *testing.T) {
		question, hash := ExtractChatQuestion([]dto.Message{
			{Role: "user", Content: []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:..."}},
				map[string]any{"type": "text", "text": "这张图是什么"},
			}},
		})
		assert.Equal(t, "这张图是什么", question)
		assert.NotEmpty(t, hash)
	})

	t.Run("empty first user message falls through to next", func(t *testing.T) {
		question, _ := ExtractChatQuestion([]dto.Message{
			{Role: "user", Content: "   "},
			{Role: "user", Content: "真正的问题"},
		})
		assert.Equal(t, "真正的问题", question)
	})

	t.Run("no user message", func(t *testing.T) {
		question, hash := ExtractChatQuestion([]dto.Message{
			{Role: "system", Content: "sys"},
		})
		assert.Empty(t, question)
		assert.Empty(t, hash)
	})

	t.Run("truncates long text but hash covers full text", func(t *testing.T) {
		long := strings.Repeat("问", 1500)
		question, hash1 := ExtractChatQuestion([]dto.Message{{Role: "user", Content: long}})
		assert.Equal(t, 1000, len([]rune(question)))
		_, hash2 := ExtractChatQuestion([]dto.Message{{Role: "user", Content: strings.Repeat("问", 1501)}})
		// 截断后前 1000 字相同，但完整文本不同必须产生不同哈希（对话去重的关键）
		assert.NotEqual(t, hash1, hash2)
	})

	t.Run("same text same hash", func(t *testing.T) {
		_, h1 := ExtractChatQuestion([]dto.Message{{Role: "user", Content: "abc"}})
		_, h2 := ExtractChatQuestion([]dto.Message{{Role: "user", Content: "abc"}})
		assert.Equal(t, h1, h2)
	})
}
