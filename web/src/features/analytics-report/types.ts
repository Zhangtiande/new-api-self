/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

export interface AnalyticsOverview {
  request_count: number
  prompt_tokens: number
  completion_tokens: number
  quota: number
}

export interface AnalyticsDimensionStat {
  name: string
  request_count: number
  prompt_tokens: number
  completion_tokens: number
  quota: number
}

export interface AnalyticsDailyStat {
  day_ts: number
  request_count: number
  prompt_tokens: number
  completion_tokens: number
  quota: number
}

export interface LatencyStats {
  count: number
  p50: number
  p95: number
}

export interface AnalyticsChannelDaily {
  day_ts: number
  frt_ms: LatencyStats
  use_time_s: LatencyStats
}

export interface AnalyticsChannelPerf {
  channel_id: number
  channel_name: string
  request_count: number
  frt_ms: LatencyStats
  use_time_s: LatencyStats
  daily: AnalyticsChannelDaily[] | null
}

export interface AnalyticsPeriodReport {
  start_ts: number
  end_ts: number
  overview: AnalyticsOverview
  daily: AnalyticsDailyStat[] | null
  models: AnalyticsDimensionStat[] | null
  apps: AnalyticsDimensionStat[] | null
  channels: AnalyticsChannelPerf[] | null
}

export interface MonthlyAnalyticsReport {
  month: string
  prev_month: string
  current: AnalyticsPeriodReport
  previous: AnalyticsPeriodReport
}

export interface MonthlyReportResponse {
  success: boolean
  message?: string
  data?: MonthlyAnalyticsReport
}
