package service

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 用户级每分钟 token 限速（TPM）。固定分钟桶 + 滑动窗口估算：
//   用量 ≈ 当前分钟桶 + 上一分钟桶 × (1 - 当前分钟已过比例)
// 记账发生在计费结算处（真实 prompt+completion 用量），拦截发生在中转入口并计入
// 本次请求的估算输入量，因此连续的大请求会被立即拦下，而不是等结算后才生效。
// ponytail: 并发同时到达的多个大请求可能同时通过入口检查（估算量未预留），
// 会在下一分钟被补偿性拦截；需要严格预留时改为入口 INCRBY 估算量、结算时补差。

const tpmBucketTTL = 3 * time.Minute

type tpmBucket struct {
	minute int64
	cur    int64
	prev   int64
}

var (
	tpmMu sync.Mutex
	// ponytail: 常驻 map，条目数等于活跃用户数，不做清理
	tpmBuckets = make(map[int]*tpmBucket)
)

// tpmRoll 把桶滚动到给定分钟：相邻分钟平移，跨多分钟清零。
func tpmRoll(b *tpmBucket, minute int64) {
	switch {
	case minute == b.minute:
	case minute == b.minute+1:
		b.prev, b.cur = b.cur, 0
		b.minute = minute
	default:
		b.prev, b.cur = 0, 0
		b.minute = minute
	}
}

// tpmSlidingUsage 计算滑动窗口用量；frac 为当前分钟已过比例 [0,1)。
func tpmSlidingUsage(cur, prev int64, frac float64) float64 {
	return float64(cur) + float64(prev)*(1-frac)
}

func tpmRedisKey(userId int, minute int64) string {
	return fmt.Sprintf("tpm:%d:%d", userId, minute)
}

// RecordTPMUsage 结算后按真实 token 用量计入当前分钟桶。
func RecordTPMUsage(ctx context.Context, userId int, tokens int) {
	if tokens <= 0 || userId <= 0 {
		return
	}
	minute := time.Now().Unix() / 60
	if common.RedisEnabled {
		key := tpmRedisKey(userId, minute)
		pipe := common.RDB.Pipeline()
		pipe.IncrBy(ctx, key, int64(tokens))
		pipe.Expire(ctx, key, tpmBucketTTL)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError("failed to record tpm usage: " + err.Error())
		}
		return
	}
	tpmMu.Lock()
	defer tpmMu.Unlock()
	b := tpmBuckets[userId]
	if b == nil {
		b = &tpmBucket{minute: minute}
		tpmBuckets[userId] = b
	}
	tpmRoll(b, minute)
	b.cur += int64(tokens)
}

// CheckTPMLimit 判断本次请求（含估算输入 token）是否在每分钟 token 上限内。
// 返回是否放行与建议的重试等待秒数；limit<=0 表示不限。
// Redis 读取失败时放行——限流不应成为可用性单点。
func CheckTPMLimit(ctx context.Context, userId int, limit int, estimatedTokens int) (bool, int) {
	if limit <= 0 {
		return true, 0
	}
	now := time.Now()
	minute := now.Unix() / 60
	frac := float64(now.Unix()%60) / 60
	var cur, prev int64
	if common.RedisEnabled {
		vals, err := common.RDB.MGet(ctx, tpmRedisKey(userId, minute), tpmRedisKey(userId, minute-1)).Result()
		if err == nil && len(vals) == 2 {
			cur = tpmParseRedisInt(vals[0])
			prev = tpmParseRedisInt(vals[1])
		}
	} else {
		tpmMu.Lock()
		if b := tpmBuckets[userId]; b != nil {
			tpmRoll(b, minute)
			cur, prev = b.cur, b.prev
		}
		tpmMu.Unlock()
	}
	if tpmSlidingUsage(cur, prev, frac)+float64(estimatedTokens) <= float64(limit) {
		return true, 0
	}
	retryAfter := 60 - int(now.Unix()%60)
	if retryAfter < 1 {
		retryAfter = 1
	}
	return false, retryAfter
}

func tpmParseRedisInt(v interface{}) int64 {
	s, ok := v.(string)
	if !ok {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}
