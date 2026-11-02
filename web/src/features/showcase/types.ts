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

export type ShowcaseSceneId =
  | 'development'
  | 'business'
  | 'knowledge'
  | 'content'
  | 'integration'

export type ShowcaseUsageRow = {
  applicationId: string
  name: string
  model: string
  bucket: number
  day: string
  tokens: number
  requests: number
}

export type ShowcaseSnapshot = {
  asOf: string
  latestBucket: string | null
  source: 'gateway'
  granularity: 'hourly'
  firstDay: string
  lastDay: string
  rows: ShowcaseUsageRow[]
}

export type ShowcaseLifetime = {
  asOf: string
  firstDay: string | null
  lastDay: string | null
  tokens: number
  requests: number
  applications: number
  models: number
}

export type ShowcaseOverview = {
  snapshot: ShowcaseSnapshot
  lifetime: ShowcaseLifetime
}

export type ShowcaseDay = { day: string; tokens: number; requests: number }
export type ShowcaseApplicationModel = {
  id: string
  tokens: number
  requests: number
}
export type ShowcaseApplicationStory = {
  scene: ShowcaseSceneId
  headline: string
  description: string
  tags: string[]
  featured: number
}

export type ShowcaseApplication = ShowcaseApplicationStory & {
  id: string
  name: string
  tokens: number
  requests: number
  models: ShowcaseApplicationModel[]
  days: ShowcaseDay[]
  activeDays: number
}

export type ShowcaseModel = ShowcaseApplicationModel & {
  type: string
  applicationIds: string[]
}
export type ShowcaseSceneDefinition = {
  id: ShowcaseSceneId
  name: string
  color: string
  note: string
}
export type ShowcaseScene = ShowcaseSceneDefinition & {
  tokens: number
  requests: number
  applications: number
}

export type ShowcaseUsage = {
  tokens: number
  requests: number
  unassignedTokens: number
  unassignedRequests: number
  firstDay: string
  lastDay: string
  applications: ShowcaseApplication[]
  scenes: ShowcaseScene[]
  models: ShowcaseModel[]
  days: ShowcaseDay[]
}

export type ShowcaseLiveApplication = {
  id: string
  name: string
  inFlight: number
  prefilling: number
  promptTokens: number | null
  maxAgeMs: number | null
}

export type ShowcaseLiveModel = {
  id: string
  inFlight: number
  generating: number
  prefilling: number | null
  promptTokens: number | null
  maxAgeMs: number | null
  observedTTFTMs: number | null
}

export type ShowcaseEngine = {
  id: string
  name: string
  asOf: string
  validUntil: string
  runningRequests: number | null
  inputTokensPerSecond: number | null
  outputTokensPerSecond: number | null
  ttftMs: number | null
  interTokenMs: number | null
  e2eLatencyMs: number | null
  cacheReuseRatio: number | null
  activeTokens: number | null
  cachedTokens: number | null
  freeTokens: number | null
  capacityTokens: number | null
}

export type ShowcaseSample = {
  asOf: string
  inFlight: number | null
  generating: number | null
  promptTokens: number | null
  inputTokensPerSecond: number | null
  outputTokensPerSecond: number | null
}

export type ShowcaseCurrent = ShowcaseSample & {
  sourceType: 'gateway'
  gatewayAvailable: boolean
  inFlight: number
  generating: number
  validUntil: string
  status: 'available' | 'stale'
  prefilling: number
  activeModels: number
  recognizedApps: number
  applications: ShowcaseLiveApplication[]
  models: ShowcaseLiveModel[]
  engines: ShowcaseEngine[]
  freshEngineCount: number
  cacheReuseRatio: number | null
  activeTokens: number | null
  cachedTokens: number | null
  freeTokens: number | null
  capacityTokens: number | null
}
