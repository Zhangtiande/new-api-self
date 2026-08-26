package service

import (
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/go-ego/gse"
)

// 内容洞察后台任务：每小时重算「今天 + 昨天」的词频聚合（覆盖跨天边界），
// 并按保留期清理问题原文。全部离线执行，不在请求路径上。
// ponytail: 单日全量重算，去重问题数在万级以内没有性能问题；
// 数据量大后可改为增量统计。

const (
	contentInsightInterval = time.Hour
	contentInsightTopTerms = 500
	contentInsightMaxTerm  = 32 // 超长“词”多为代码/URL 片段，直接丢弃
)

var (
	gseOnce sync.Once
	gseSeg  gse.Segmenter
)

func contentInsightSegmenter() *gse.Segmenter {
	gseOnce.Do(func() {
		// 内嵌简体词典 + 内嵌停用词表；失败时降级为空词典（仍可按连续单字切分）
		if err := gseSeg.LoadDictEmbed("zh_s"); err != nil {
			common.SysError("content insight: load segmenter dict failed: " + err.Error())
		}
		if err := gseSeg.LoadStopEmbed(); err != nil {
			common.SysError("content insight: load stop words failed: " + err.Error())
		}
	})
	return &gseSeg
}

// contentInsightExtraStops 领域补充停用词：对话里高频但无信息量的词。
var contentInsightExtraStops = map[string]struct{}{
	"帮我": {}, "请问": {}, "一下": {}, "什么": {}, "怎么": {}, "如何": {},
	"可以": {}, "需要": {}, "问题": {}, "现在": {}, "这个": {}, "那个": {},
	"是否": {}, "为什么": {}, "哪些": {}, "多少": {}, "进行": {}, "使用": {},
	"please": {}, "help": {}, "want": {}, "need": {}, "using": {}, "make": {},
}

func contentInsightTermOk(term string) bool {
	runes := []rune(term)
	if len(runes) < 2 || len(runes) > contentInsightMaxTerm {
		return false
	}
	hasLetter := false
	for _, r := range runes {
		if unicode.IsLetter(r) {
			hasLetter = true
			break
		}
	}
	if !hasLetter {
		return false
	}
	if _, ok := contentInsightExtraStops[term]; ok {
		return false
	}
	return !contentInsightSegmenter().IsStop(term)
}

// contentInsightSegment 切分一条问题并去重：词云统计的是“包含该词的问题数”，
// 避免单条长问题刷高词频。
func contentInsightSegment(text string) []string {
	seg := contentInsightSegmenter()
	seen := make(map[string]struct{})
	terms := make([]string, 0, 16)
	for _, raw := range seg.Cut(text, true) {
		term := strings.ToLower(strings.TrimSpace(raw))
		if term == "" || !contentInsightTermOk(term) {
			continue
		}
		if _, ok := seen[term]; ok {
			continue
		}
		seen[term] = struct{}{}
		terms = append(terms, term)
	}
	return terms
}

func contentInsightRecomputeDay(dayStart, dayEnd time.Time) error {
	questions, err := model.GetDistinctChatQuestionsBetween(dayStart.Unix(), dayEnd.Unix())
	if err != nil {
		return err
	}
	counts := make(map[string]int64)
	for _, q := range questions {
		for _, term := range contentInsightSegment(q) {
			counts[term]++
		}
	}
	stats := make([]model.ChatTermCount, 0, len(counts))
	for term, count := range counts {
		stats = append(stats, model.ChatTermCount{Term: term, Count: count})
	}
	// 只保留 Top N，入库前排序截断
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].Count != stats[j].Count {
			return stats[i].Count > stats[j].Count
		}
		return stats[i].Term < stats[j].Term
	})
	if len(stats) > contentInsightTopTerms {
		stats = stats[:contentInsightTopTerms]
	}
	return model.ReplaceChatTermStatsForDay(dayStart.Unix(), stats)
}

func runContentInsightOnce() {
	settings := operation_setting.GetContentInsightSettings()
	if !settings.Enabled || common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return
	}
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	yesterday := today.AddDate(0, 0, -1)
	if err := contentInsightRecomputeDay(yesterday, today); err != nil {
		common.SysError("content insight: recompute yesterday failed: " + err.Error())
	}
	if err := contentInsightRecomputeDay(today, today.AddDate(0, 0, 1)); err != nil {
		common.SysError("content insight: recompute today failed: " + err.Error())
	}
	if settings.RetentionDays > 0 {
		cutoff := now.AddDate(0, 0, -settings.RetentionDays).Unix()
		if _, err := model.PurgeChatQuestionsBefore(cutoff); err != nil {
			common.SysError("content insight: purge failed: " + err.Error())
		}
	}
}

// StartContentInsightWorker 常驻后台任务入口（main 启动一次）。
func StartContentInsightWorker() {
	for {
		runContentInsightOnce()
		time.Sleep(contentInsightInterval)
	}
}
