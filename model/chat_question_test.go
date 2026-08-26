package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupChatQuestionDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&ChatQuestion{}, &ChatTermStat{}))
	orig := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = orig })
}

func TestChatQuestionQueries(t *testing.T) {
	setupChatQuestionDB(t)

	// 同一对话（hash-a）三轮 agent 重发 + 另一对话（hash-b）一轮
	rows := []ChatQuestion{
		{CreatedAt: 100, UserId: 1, Username: "alice", TokenName: "app1", ModelName: "m1", QuestionHash: "hash-a", Question: "怎么部署服务"},
		{CreatedAt: 200, UserId: 1, Username: "alice", TokenName: "app1", ModelName: "m1", QuestionHash: "hash-a", Question: "怎么部署服务"},
		{CreatedAt: 300, UserId: 1, Username: "alice", TokenName: "app1", ModelName: "m1", QuestionHash: "hash-a", Question: "怎么部署服务"},
		{CreatedAt: 250, UserId: 2, Username: "bob", TokenName: "app2", ModelName: "m2", QuestionHash: "hash-b", Question: "写一个正则"},
	}
	require.NoError(t, LOG_DB.Create(&rows).Error)

	// 去重分组：hash-a 计 3 次但算一个问题，按次数排序
	groups, total, err := GetTopChatQuestions(ChatQuestionFilter{StartTs: 0, EndTs: 1000}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, groups, 2)
	assert.Equal(t, "hash-a", groups[0].QuestionHash)
	assert.Equal(t, int64(3), groups[0].Count)
	assert.Equal(t, int64(300), groups[0].LastAt)
	assert.Equal(t, "怎么部署服务", groups[0].Question)

	// 过滤：按用户名 / 关键词 / 时间窗
	groups, total, err = GetTopChatQuestions(ChatQuestionFilter{StartTs: 0, EndTs: 1000, Username: "bob"}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "hash-b", groups[0].QuestionHash)

	groups, _, err = GetTopChatQuestions(ChatQuestionFilter{StartTs: 0, EndTs: 1000, Keyword: "正则"}, 0, 10)
	require.NoError(t, err)
	require.Len(t, groups, 1)
	assert.Equal(t, "hash-b", groups[0].QuestionHash)

	_, total, err = GetTopChatQuestions(ChatQuestionFilter{StartTs: 260, EndTs: 1000}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total, "time window excludes hash-b at 250")

	// 分词任务的去重取数：每个哈希只出一条
	questions, err := GetDistinctChatQuestionsBetween(0, 1000)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"怎么部署服务", "写一个正则"}, questions)

	// 保留期清理
	deleted, err := PurgeChatQuestionsBefore(250)
	require.NoError(t, err)
	assert.Equal(t, int64(2), deleted)
}

func TestChatTermStatsReplaceAndSum(t *testing.T) {
	setupChatQuestionDB(t)

	day1, day2 := int64(86400), int64(172800)
	require.NoError(t, ReplaceChatTermStatsForDay(day1, []ChatTermCount{
		{Term: "部署", Count: 3},
		{Term: "网关", Count: 1},
	}))
	require.NoError(t, ReplaceChatTermStatsForDay(day2, []ChatTermCount{
		{Term: "部署", Count: 2},
	}))

	// 跨天求和 + 按总量降序
	terms, err := GetChatTermStats(0, day2+86400, 10)
	require.NoError(t, err)
	require.Len(t, terms, 2)
	assert.Equal(t, ChatTermCount{Term: "部署", Count: 5}, terms[0])
	assert.Equal(t, ChatTermCount{Term: "网关", Count: 1}, terms[1])

	// 全量替换：重算某天后旧数据不残留
	require.NoError(t, ReplaceChatTermStatsForDay(day1, []ChatTermCount{{Term: "报表", Count: 9}}))
	terms, err = GetChatTermStats(day1, day1+86400, 10)
	require.NoError(t, err)
	require.Len(t, terms, 1)
	assert.Equal(t, "报表", terms[0].Term)
}
