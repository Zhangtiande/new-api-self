package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTPMRoll(t *testing.T) {
	b := &tpmBucket{minute: 100, cur: 500, prev: 300}
	tpmRoll(b, 100)
	assert.Equal(t, int64(500), b.cur)
	assert.Equal(t, int64(300), b.prev)

	tpmRoll(b, 101) // 相邻分钟：cur 平移到 prev
	assert.Equal(t, int64(0), b.cur)
	assert.Equal(t, int64(500), b.prev)

	tpmRoll(b, 105) // 跨多分钟：全部清零
	assert.Equal(t, int64(0), b.cur)
	assert.Equal(t, int64(0), b.prev)
}

func TestTPMSlidingUsage(t *testing.T) {
	assert.InDelta(t, 1000.0, tpmSlidingUsage(1000, 0, 0.5), 0.001)
	assert.InDelta(t, 600.0, tpmSlidingUsage(0, 1200, 0.5), 0.001)
	assert.InDelta(t, 1200.0, tpmSlidingUsage(0, 1200, 0), 0.001)
	assert.InDelta(t, 1300.0, tpmSlidingUsage(1000, 1200, 0.75), 0.001)
}

func TestTPMLimiterMemory(t *testing.T) {
	origRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = origRedis })
	tpmMu.Lock()
	tpmBuckets = make(map[int]*tpmBucket)
	tpmMu.Unlock()

	ctx := context.Background()

	// 无用量时按估算值放行/拦截
	allowed, _ := CheckTPMLimit(ctx, 42, 1000, 500)
	require.True(t, allowed)
	allowed, _ = CheckTPMLimit(ctx, 42, 1000, 1500)
	require.False(t, allowed)

	// 记账后超限拦截，Retry-After 在 (0, 60] 内
	RecordTPMUsage(ctx, 42, 900)
	allowed, retryAfter := CheckTPMLimit(ctx, 42, 1000, 500)
	require.False(t, allowed)
	assert.GreaterOrEqual(t, retryAfter, 1)
	assert.LessOrEqual(t, retryAfter, 60)

	// limit<=0 表示不限；其他用户不受影响
	allowed, _ = CheckTPMLimit(ctx, 42, 0, 10000000)
	require.True(t, allowed)
	allowed, _ = CheckTPMLimit(ctx, 7, 1000, 500)
	require.True(t, allowed)
}
