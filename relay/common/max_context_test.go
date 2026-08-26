package common

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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

// 算力策略兜底：双方均为 0 时取时段默认；显式配置（正值/-1 豁免）全天生效。
func TestMaxContextAndTPMPolicyFallback(t *testing.T) {
	settings := operation_setting.GetComputePolicySettings()
	orig := *settings
	t.Cleanup(func() { *settings = orig })
	settings.Enabled = true
	settings.Windows = []operation_setting.ComputePolicyWindow{
		{Start: "00:00", End: "24:00", MaxContextTokens: 32000, TPMLimit: 100000},
	}

	// 未显式配置 → 策略默认
	info := &RelayInfo{}
	assert.Equal(t, 32000, info.GetMaxContextTokens())
	assert.Equal(t, 100000, info.GetTPMLimit())

	// 显式正值无视策略默认，全天生效（可高于策略值）
	info = &RelayInfo{TokenMaxContextTokens: 200000}
	assert.Equal(t, 200000, info.GetMaxContextTokens())
	info = &RelayInfo{UserSetting: dto.UserSetting{MaxContextTokens: 64000}}
	assert.Equal(t, 64000, info.GetMaxContextTokens())
	info = &RelayInfo{UserSetting: dto.UserSetting{TPMLimit: 500000}}
	assert.Equal(t, 500000, info.GetTPMLimit())

	// -1 显式豁免 → 不限
	info = &RelayInfo{TokenMaxContextTokens: -1}
	assert.Equal(t, 0, info.GetMaxContextTokens())
	info = &RelayInfo{UserSetting: dto.UserSetting{TPMLimit: -1}}
	assert.Equal(t, 0, info.GetTPMLimit())

	// 豁免的一方不遮蔽另一方的显式上限
	info = &RelayInfo{TokenMaxContextTokens: -1, UserSetting: dto.UserSetting{MaxContextTokens: 4096}}
	assert.Equal(t, 4096, info.GetMaxContextTokens())

	// 策略关闭 → 0 回到不限
	settings.Enabled = false
	info = &RelayInfo{}
	assert.Equal(t, 0, info.GetMaxContextTokens())
	assert.Equal(t, 0, info.GetTPMLimit())
}
