package model

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type showcaseMatrixToken struct {
	ID        int `gorm:"primaryKey"`
	Name      string
	DeletedAt gorm.DeletedAt
}

func (showcaseMatrixToken) TableName() string { return "tokens" }

type showcaseMatrixQuotaData struct {
	ID        int `gorm:"primaryKey"`
	TokenID   int
	ModelName string `gorm:"size:64"`
	CreatedAt int64
	TokenUsed int64
	Count     int64
	UseGroup  string `gorm:"size:64"`
	ChannelID int
}

func (showcaseMatrixQuotaData) TableName() string { return "quota_data" }

func TestShowcaseUsageDatabaseMatrix(t *testing.T) {
	tests := []struct {
		name string
		env  string
		open func(string) gorm.Dialector
	}{
		{name: "sqlite", open: func(string) gorm.Dialector { return sqlite.Open(":memory:") }},
		{name: "mysql", env: "TEST_MYSQL_DSN", open: func(dsn string) gorm.Dialector { return mysql.Open(dsn) }},
		{name: "postgres", env: "TEST_POSTGRES_DSN", open: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := os.Getenv(test.env)
			if test.env != "" && dsn == "" {
				t.Skip(test.env + " is not configured")
			}
			db, err := gorm.Open(test.open(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			var version string
			switch test.name {
			case "sqlite":
				require.NoError(t, db.Raw("SELECT sqlite_version()").Scan(&version).Error)
			case "mysql":
				var database string
				require.NoError(t, db.Raw("SELECT DATABASE()").Scan(&database).Error)
				require.True(t, strings.HasPrefix(database, "showcase_matrix"), "use a new isolated showcase_matrix database; never point this fixture at application data")
				require.NoError(t, db.Raw("SELECT VERSION()").Scan(&version).Error)
			case "postgres":
				var database string
				require.NoError(t, db.Raw("SELECT current_database()").Scan(&database).Error)
				require.True(t, strings.HasPrefix(database, "showcase_matrix"), "use a new isolated showcase_matrix database; never point this fixture at application data")
				require.NoError(t, db.Raw("SELECT VERSION()").Scan(&version).Error)
			}
			t.Logf("real database: %s", version)
			require.False(t, db.Migrator().HasTable(&showcaseMatrixQuotaData{}), "fixture database must not contain quota_data")
			require.False(t, db.Migrator().HasTable(&showcaseMatrixToken{}), "fixture database must not contain tokens")
			t.Cleanup(func() {
				_ = db.Migrator().DropTable(&showcaseMatrixQuotaData{}, &showcaseMatrixToken{})
			})
			require.NoError(t, db.AutoMigrate(&showcaseMatrixToken{}, &showcaseMatrixQuotaData{}))
			require.NoError(t, db.AutoMigrate(&showcaseMatrixToken{}, &showcaseMatrixQuotaData{}))
			require.NoError(t, db.Create(&[]showcaseMatrixToken{
				{ID: 11, Name: "DIS-测试归属-A1-Gentis"},
				{ID: 22, Name: "DIS-owner-deleted", DeletedAt: gorm.DeletedAt{Time: time.Unix(1000, 0), Valid: true}},
			}).Error)
			require.NoError(t, db.Create(&[]showcaseMatrixQuotaData{
				{TokenID: 11, ModelName: "gentis", CreatedAt: 3600, TokenUsed: 100, Count: 2, UseGroup: "first", ChannelID: 1},
				{TokenID: 11, ModelName: "gentis", CreatedAt: 3600, TokenUsed: 300, Count: 3, UseGroup: "second", ChannelID: 2},
				{TokenID: 11, ModelName: "gentis-thinking", CreatedAt: 3600, TokenUsed: 70, Count: 1},
				{TokenID: 11, ModelName: "gentis", CreatedAt: 7200, TokenUsed: 80, Count: 1},
				{TokenID: 22, ModelName: "gentis", CreatedAt: 3600, TokenUsed: 20, Count: 1},
				{TokenID: 99, ModelName: "gentis", CreatedAt: 3600, TokenUsed: 10, Count: 1},
				{TokenID: 0, ModelName: "gentis", CreatedAt: 7200, TokenUsed: 5, Count: 1},
				{TokenID: 11, ModelName: "gentis", CreatedAt: 3599, TokenUsed: 999, Count: 99},
				{TokenID: 11, ModelName: "gentis", CreatedAt: 10800, TokenUsed: 888, Count: 88},
				{TokenID: 11, ModelName: "qwen3-coder", CreatedAt: 1, TokenUsed: 7, Count: 1},
			}).Error)

			rows, err := QueryShowcaseUsage(db, 3600, 10800)
			require.NoError(t, err)
			assert.Equal(t, []ShowcaseUsageRow{
				{TokenID: 11, TokenName: "DIS-测试归属-A1-Gentis", ModelName: "gentis", CreatedAt: 3600, Tokens: 400, Requests: 5},
				{TokenID: 11, TokenName: "DIS-测试归属-A1-Gentis", ModelName: "gentis-thinking", CreatedAt: 3600, Tokens: 70, Requests: 1},
				{TokenID: 22, ModelName: "gentis", CreatedAt: 3600, Tokens: 20, Requests: 1},
				{TokenID: 99, ModelName: "gentis", CreatedAt: 3600, Tokens: 10, Requests: 1},
				{TokenID: 0, ModelName: "gentis", CreatedAt: 7200, Tokens: 5, Requests: 1},
				{TokenID: 11, TokenName: "DIS-测试归属-A1-Gentis", ModelName: "gentis", CreatedAt: 7200, Tokens: 80, Requests: 1},
			}, rows)
			var tokens, requests int64
			for _, row := range rows {
				tokens += row.Tokens
				requests += row.Requests
			}
			assert.EqualValues(t, 585, tokens)
			assert.EqualValues(t, 10, requests)
			empty, err := QueryShowcaseUsage(db, 7200, 7200)
			require.NoError(t, err)
			assert.Empty(t, empty)
			lifetime, err := QueryShowcaseLifetimeUsage(db, 10800)
			require.NoError(t, err)
			assert.Equal(t, []ShowcaseLifetimeUsageRow{
				{TokenID: 0, ModelName: "gentis", FirstAt: 7200, LastAt: 7200, Tokens: 5, Requests: 1},
				{TokenID: 11, TokenName: "DIS-测试归属-A1-Gentis", ModelName: "gentis", FirstAt: 3599, LastAt: 7200, Tokens: 1479, Requests: 105},
				{TokenID: 11, TokenName: "DIS-测试归属-A1-Gentis", ModelName: "gentis-thinking", FirstAt: 3600, LastAt: 3600, Tokens: 70, Requests: 1},
				{TokenID: 11, TokenName: "DIS-测试归属-A1-Gentis", ModelName: "qwen3-coder", FirstAt: 1, LastAt: 1, Tokens: 7, Requests: 1},
				{TokenID: 22, ModelName: "gentis", FirstAt: 3600, LastAt: 3600, Tokens: 20, Requests: 1},
				{TokenID: 99, ModelName: "gentis", FirstAt: 3600, LastAt: 3600, Tokens: 10, Requests: 1},
			}, lifetime)
			var lifetimeTokens, lifetimeRequests int64
			for _, row := range lifetime {
				lifetimeTokens += row.Tokens
				lifetimeRequests += row.Requests
			}
			assert.EqualValues(t, 1591, lifetimeTokens)
			assert.EqualValues(t, 110, lifetimeRequests)
			emptyLifetime, err := QueryShowcaseLifetimeUsage(db, 0)
			require.NoError(t, err)
			assert.Empty(t, emptyLifetime)

			require.NoError(t, db.Create(&showcaseMatrixQuotaData{TokenID: 11, ModelName: "invalid", CreatedAt: 3600, TokenUsed: -1, Count: 1}).Error)
			_, err = QueryShowcaseUsage(db, 3600, 10800)
			assert.ErrorContains(t, err, "invalid showcase usage values")
			_, err = QueryShowcaseLifetimeUsage(db, 10800)
			assert.ErrorContains(t, err, "invalid showcase lifetime values")
		})
	}
}
