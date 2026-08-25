package common

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
)

func TestGetMaxContextTokens(t *testing.T) {
	tests := []struct {
		name       string
		tokenLimit int
		userLimit  int
		want       int
	}{
		{name: "both unset means unlimited", tokenLimit: 0, userLimit: 0, want: 0},
		{name: "token level only", tokenLimit: 96000, userLimit: 0, want: 96000},
		{name: "user level only", tokenLimit: 0, userLimit: 128000, want: 128000},
		{name: "both set takes smaller", tokenLimit: 96000, userLimit: 1000000, want: 96000},
		{name: "both set takes smaller reversed", tokenLimit: 1000000, userLimit: 96000, want: 96000},
		{name: "negative token limit treated as unlimited", tokenLimit: -1, userLimit: 0, want: 0},
		{name: "negative token limit falls back to user limit", tokenLimit: -1, userLimit: 4096, want: 4096},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &RelayInfo{
				TokenMaxContextTokens: tt.tokenLimit,
				UserSetting:           dto.UserSetting{MaxContextTokens: tt.userLimit},
			}
			assert.Equal(t, tt.want, info.GetMaxContextTokens())
		})
	}

	var nilInfo *RelayInfo
	assert.Equal(t, 0, nilInfo.GetMaxContextTokens())
}
