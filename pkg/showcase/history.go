// Package showcase produces visitor-facing aggregates without operational identities.
package showcase

import (
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const maxSafeInteger int64 = 1<<53 - 1

var (
	showcaseZone = time.FixedZone("Asia/Shanghai", 8*60*60)
	keyName      = regexp.MustCompile(`^(?:SI[0-9A-Z_]*|IC[0-9A-Z_]*|DIS|CBD|YMSLX)-[^-]+-(.+)$`)
	codeName     = regexp.MustCompile(`(?i)^(?:代码辅助|(?:MES[-_\s]*)?Cline[-_\s]*代码辅助)$`)
	unsafeName   = regexp.MustCompile(`(?i)[\x00-\x1f\x7f<>]|(?:\d{1,3}\.){3}\d{1,3}|sk-|https?:|@`)
	appAliases   = map[string]string{
		"台湾日计A1-STAGE": "日计业务 A1", "yCopilot_YMCN": "yCopilot", "绩牛测试": "应用集成验证",
		"技术组项目(外部)": "技术应用服务", "2D 转 3Dagent": "2D / 3D 智能体",
	}
)

type ApplicationIdentity struct {
	ID   string
	Name string
}

func ApplicationFromKeyName(name string) ApplicationIdentity {
	name = strings.TrimSpace(name)
	application := ""
	switch {
	case codeName.MatchString(name):
		application = "代码辅助"
	case name == "YMSLX-GPT-WEB":
		application = "GPT-WEB"
	case strings.HasPrefix(strings.ToLower(name), "openclaw"):
		application = "OpenClaw"
	default:
		if match := keyName.FindStringSubmatch(name); len(match) == 2 {
			application = strings.TrimSpace(match[1])
		}
	}
	if application == "" || application == "未归属应用" || unsafeName.MatchString(application) {
		return ApplicationIdentity{ID: "unassigned", Name: "Unassigned application"}
	}
	if codeName.MatchString(application) {
		application = "代码辅助"
	} else if alias, ok := appAliases[application]; ok {
		application = alias
	}
	application = limitRunes(application, 60)
	return ApplicationIdentity{ID: "app:" + application, Name: application}
}

func safeModel(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || unsafeName.MatchString(name) {
		return "Unclassified model"
	}
	return limitRunes(name, 90)
}

func limitRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

// HistoryWindow returns thirty Beijing calendar days, with an exclusive upper bound.
func HistoryWindow(now time.Time) (int64, int64) {
	local := now.In(showcaseZone)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, showcaseZone)
	return day.AddDate(0, 0, -29).Unix(), now.Unix() + 1
}

type UsageRow struct {
	TokenName string
	ModelName string
	CreatedAt int64
	Tokens    int64
	Requests  int64
}

type HistoryRow struct {
	ApplicationID string `json:"applicationId"`
	Name          string `json:"name"`
	Model         string `json:"model"`
	Day           string `json:"day"`
	Bucket        int64  `json:"bucket"`
	Tokens        int64  `json:"tokens"`
	Requests      int64  `json:"requests"`
}

type History struct {
	AsOf         string       `json:"asOf"`
	LatestBucket *string      `json:"latestBucket"`
	Source       string       `json:"source"`
	Granularity  string       `json:"granularity"`
	FirstDay     string       `json:"firstDay"`
	LastDay      string       `json:"lastDay"`
	Rows         []HistoryRow `json:"rows"`
}

func BuildHistory(rows []UsageRow, now time.Time) (*History, error) {
	start, end := HistoryWindow(now)
	history := &History{AsOf: now.UTC().Format(time.RFC3339Nano), Source: "gateway", Granularity: "hourly", FirstDay: time.Unix(start, 0).In(showcaseZone).Format("2006-01-02"), LastDay: now.In(showcaseZone).Format("2006-01-02"), Rows: make([]HistoryRow, 0)}
	type rowKey struct {
		application, model string
		bucket             int64
	}
	groups := make(map[rowKey]*HistoryRow)
	latest := int64(0)
	for _, row := range rows {
		if row.CreatedAt < start || row.CreatedAt >= end || row.Tokens < 0 || row.Requests < 0 {
			return nil, errors.New("invalid showcase history aggregate")
		}
		identity := ApplicationFromKeyName(row.TokenName)
		model := safeModel(row.ModelName)
		key := rowKey{identity.ID, model, row.CreatedAt}
		group := groups[key]
		if group == nil {
			group = &HistoryRow{ApplicationID: identity.ID, Name: identity.Name, Model: model, Day: time.Unix(row.CreatedAt, 0).In(showcaseZone).Format("2006-01-02"), Bucket: row.CreatedAt}
			groups[key] = group
		}
		if row.Tokens > maxSafeInteger-group.Tokens || row.Requests > maxSafeInteger-group.Requests {
			return nil, errors.New("showcase history exceeds safe numeric range")
		}
		group.Tokens += row.Tokens
		group.Requests += row.Requests
		latest = max(latest, row.CreatedAt)
	}
	for _, row := range groups {
		history.Rows = append(history.Rows, *row)
	}
	sort.Slice(history.Rows, func(i, j int) bool {
		a, b := history.Rows[i], history.Rows[j]
		if a.Bucket != b.Bucket {
			return a.Bucket < b.Bucket
		}
		if a.ApplicationID != b.ApplicationID {
			return a.ApplicationID < b.ApplicationID
		}
		return a.Model < b.Model
	})
	if len(rows) > 0 {
		stamp := time.Unix(latest, 0).UTC().Format(time.RFC3339Nano)
		history.LatestBucket = &stamp
	}
	return history, nil
}

func number(value float64) *float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return nil
	}
	return &value
}
