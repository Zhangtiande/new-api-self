package common

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/QuantumNous/new-api/relaykit/dto"
)

// chatQuestionMaxRunes 问题文本截断长度。均值 1.4 万 token 的 agent 请求
// 里绝大部分是重发的历史与工具输出，只保留“人问的那句话”。
const chatQuestionMaxRunes = 1000

// ExtractChatQuestion 提取对话中第一条非空 user 消息的文本作为“问题”。
// agent 多轮重发同一对话时首条 user 消息不变，哈希相同，查询端按哈希
// 去重即可把一次对话归并为一条。返回截断文本与完整文本的哈希。
func ExtractChatQuestion(messages []dto.Message) (question string, hash string) {
	for i := range messages {
		if messages[i].Role != "user" {
			continue
		}
		text := strings.TrimSpace(messages[i].StringContent())
		if text == "" {
			// 例如纯图片消息，继续找下一条 user 消息
			continue
		}
		sum := sha256.Sum256([]byte(text))
		runes := []rune(text)
		if len(runes) > chatQuestionMaxRunes {
			text = string(runes[:chatQuestionMaxRunes])
		}
		return text, hex.EncodeToString(sum[:16])
	}
	return "", ""
}
