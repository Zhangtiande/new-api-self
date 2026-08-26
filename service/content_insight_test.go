package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContentInsightSegment(t *testing.T) {
	terms := contentInsightSegment("怎么在 Kubernetes 集群里部署部署服务，Kubernetes 好用吗")
	require.NotEmpty(t, terms)

	set := make(map[string]bool)
	for _, term := range terms {
		set[term] = true
	}
	// 领域词保留，英文统一小写
	assert.True(t, set["kubernetes"], "expected kubernetes in %v", terms)
	assert.True(t, set["部署"], "expected 部署 in %v", terms)
	// 单条问题内去重：重复出现的词只计一次
	count := 0
	for _, term := range terms {
		if term == "kubernetes" {
			count++
		}
	}
	assert.Equal(t, 1, count)
	// 停用词与单字被过滤
	assert.False(t, set["怎么"], "stopword 怎么 should be filtered: %v", terms)
	assert.False(t, set["在"], "single rune should be filtered: %v", terms)
	assert.False(t, set["吗"], "single rune should be filtered: %v", terms)
}

func TestContentInsightTermOk(t *testing.T) {
	assert.False(t, contentInsightTermOk("a"), "single rune")
	assert.False(t, contentInsightTermOk("12345"), "pure digits")
	assert.False(t, contentInsightTermOk("——"), "punctuation only")
	assert.False(t, contentInsightTermOk("帮我"), "extra stopword")
	assert.True(t, contentInsightTermOk("网关"))
	assert.True(t, contentInsightTermOk("gateway"))
}
