package operation_setting

import (
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/setting/config"
)

// 算力策略：按时间窗口为「未显式配置上限」的用户/令牌提供默认的
// 单请求上下文上限与每分钟 token 上限（TPM）。
//   - 显式配置（正值全天生效，-1 显式豁免）不受策略影响；
//   - 窗口按配置顺序取第一个命中；时间按服务器本地时区判定；
//   - 未启用或无命中时不施加任何默认限制。

type ComputePolicyWindow struct {
	Name             string `json:"name,omitempty"`
	Weekdays         []int  `json:"weekdays,omitempty"` // 0=周日 … 6=周六；空表示每天
	Start            string `json:"start"`              // "HH:MM"（含）
	End              string `json:"end"`                // "HH:MM"（不含）；小于 Start 表示跨天
	MaxContextTokens int    `json:"max_context_tokens,omitempty"`
	TPMLimit         int    `json:"tpm_limit,omitempty"`
}

type ComputePolicySettings struct {
	Enabled bool                  `json:"enabled"`
	Windows []ComputePolicyWindow `json:"windows"`
}

var computePolicySettings = ComputePolicySettings{
	Enabled: false,
	Windows: []ComputePolicyWindow{},
}

func init() {
	config.GlobalConfig.Register("compute_policy", &computePolicySettings)
}

func GetComputePolicySettings() *ComputePolicySettings {
	return &computePolicySettings
}

// parsePolicyClock 解析 "HH:MM" 为当日分钟数；End 允许 "24:00"。
func parsePolicyClock(s string) (int, bool) {
	parts := strings.SplitN(strings.TrimSpace(s), ":", 2)
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 24 || m < 0 || m > 59 || (h == 24 && m != 0) {
		return 0, false
	}
	return h*60 + m, true
}

// MatchComputePolicyWindowAt 返回给定时刻第一个命中的窗口；
// 策略未启用、窗口配置非法或无命中时返回 nil。
func MatchComputePolicyWindowAt(t time.Time) *ComputePolicyWindow {
	if !computePolicySettings.Enabled {
		return nil
	}
	minute := t.Hour()*60 + t.Minute()
	weekday := int(t.Weekday())
	for i := range computePolicySettings.Windows {
		w := &computePolicySettings.Windows[i]
		start, okStart := parsePolicyClock(w.Start)
		end, okEnd := parsePolicyClock(w.End)
		if !okStart || !okEnd || start == end {
			continue
		}
		// 跨天窗口按当前时刻的星期判断
		if len(w.Weekdays) > 0 && !slices.Contains(w.Weekdays, weekday) {
			continue
		}
		var inRange bool
		if start < end {
			inRange = minute >= start && minute < end
		} else {
			inRange = minute >= start || minute < end
		}
		if inRange {
			return w
		}
	}
	return nil
}

// ActiveComputePolicyWindow 返回当前时刻命中的策略窗口（服务器本地时区）。
func ActiveComputePolicyWindow() *ComputePolicyWindow {
	return MatchComputePolicyWindowAt(time.Now())
}
