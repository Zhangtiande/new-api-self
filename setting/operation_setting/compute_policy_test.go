package operation_setting

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 2026-08-24 是周一。
func policyTime(day, hour, minute int) time.Time {
	return time.Date(2026, 8, day, hour, minute, 0, 0, time.UTC)
}

func withPolicySettings(t *testing.T, s ComputePolicySettings) {
	t.Helper()
	orig := computePolicySettings
	computePolicySettings = s
	t.Cleanup(func() { computePolicySettings = orig })
}

func TestMatchComputePolicyWindowAt(t *testing.T) {
	workday := ComputePolicyWindow{
		Name:             "peak",
		Weekdays:         []int{1, 2, 3, 4, 5},
		Start:            "09:00",
		End:              "18:00",
		MaxContextTokens: 32000,
		TPMLimit:         100000,
	}
	night := ComputePolicyWindow{Name: "night", Start: "22:00", End: "06:00"}

	withPolicySettings(t, ComputePolicySettings{Enabled: true, Windows: []ComputePolicyWindow{workday, night}})

	tests := []struct {
		name string
		at   time.Time
		want string // 命中窗口名；空表示无命中
	}{
		{"weekday peak start inclusive", policyTime(24, 9, 0), "peak"},
		{"weekday before peak", policyTime(24, 8, 59), ""},
		{"weekday peak end exclusive", policyTime(24, 18, 0), ""},
		{"saturday not in weekdays", policyTime(29, 10, 0), ""},
		{"cross midnight late night", policyTime(24, 23, 0), "night"},
		{"cross midnight early morning", policyTime(24, 5, 59), "night"},
		{"cross midnight noon no match", policyTime(29, 12, 0), ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MatchComputePolicyWindowAt(tt.at)
			if tt.want == "" {
				assert.Nil(t, got)
				return
			}
			require.NotNil(t, got)
			assert.Equal(t, tt.want, got.Name)
		})
	}
}

func TestMatchComputePolicyWindowDisabledAndInvalid(t *testing.T) {
	valid := ComputePolicyWindow{Name: "all-day", Start: "00:00", End: "24:00", MaxContextTokens: 1000}

	withPolicySettings(t, ComputePolicySettings{Enabled: false, Windows: []ComputePolicyWindow{valid}})
	assert.Nil(t, MatchComputePolicyWindowAt(policyTime(24, 10, 0)), "disabled policy never matches")

	// 非法时间的窗口被跳过，命中后面的合法窗口；首个命中优先
	invalid := ComputePolicyWindow{Name: "broken", Start: "9am", End: "18:00"}
	first := ComputePolicyWindow{Name: "first", Start: "00:00", End: "24:00"}
	withPolicySettings(t, ComputePolicySettings{Enabled: true, Windows: []ComputePolicyWindow{invalid, first, valid}})
	got := MatchComputePolicyWindowAt(policyTime(24, 10, 0))
	require.NotNil(t, got)
	assert.Equal(t, "first", got.Name)
}
