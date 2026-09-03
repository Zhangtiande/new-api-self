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

import { api } from '@/lib/api'

export type EngineStats = {
  channel_id: number
  channel_name: string
  url: string
  fresh: boolean
  error?: string
  scraped_at: number
  age_ms: number
  running_reqs: number
  queued_reqs: number
  token_usage: number
  used_tokens: number
  cache_hit_rate: number
  gen_throughput: number
  ttft_ms: number
  e2e_latency_ms: number
  inter_token_ms: number
  queue_time_ms: number
  prompt_tokens_rate: number
  output_tokens_rate: number
}

export type ChannelLive = {
  channel_id: number
  channel_name: string
  gateway_in_flight: number
  gateway_prefilling: number
  engine?: EngineStats
  gap: number
  has_engine: boolean
}

export type ModelLive = {
  model: string
  in_flight: number
  prefilling: number
  generating: number
  max_age_ms: number
  prompt_tokens: number
  avg_observed_ttft_ms: number
}

export type RequestLive = {
  request_id: string
  model: string
  group: string
  channel_id: number
  user_id: number
  token_id: number
  age_ms: number
  ttft_ms: number
  prompt_tokens: number
  retries: number
  is_stream: boolean
}

export type LiveStatus = {
  ts: number
  total_in_flight: number
  models: ModelLive[]
  channels: ChannelLive[]
  requests: RequestLive[]
  truncated: boolean
}

export async function getLiveStatus() {
  const res = await api.get<{
    success: boolean
    message?: string
    data?: LiveStatus
  }>('/api/live-status')
  return res.data
}
