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

export type ContentTerm = {
  term: string
  count: number
}

export type ContentQuestion = {
  question_hash: string
  question: string
  count: number
  last_at: number
}

export type ContentTermsResponse = {
  success: boolean
  message?: string
  data?: {
    enabled: boolean
    terms: ContentTerm[]
  }
}

export type ContentQuestionsResponse = {
  success: boolean
  message?: string
  data?: {
    enabled: boolean
    questions: ContentQuestion[]
    total: number
    page: number
    page_size: number
  }
}

export async function getContentTerms(
  startTs: number,
  endTs: number
): Promise<ContentTermsResponse> {
  const res = await api.get<ContentTermsResponse>(
    '/api/analytics/content-terms',
    { params: { start_ts: String(startTs), end_ts: String(endTs) } }
  )
  return res.data
}

export type ContentQuestionsParams = {
  startTs: number
  endTs: number
  keyword?: string
  username?: string
  tokenName?: string
  page?: number
  pageSize?: number
}

export async function getContentQuestions(
  params: ContentQuestionsParams
): Promise<ContentQuestionsResponse> {
  const query: Record<string, string> = {
    start_ts: String(params.startTs),
    end_ts: String(params.endTs),
  }
  if (params.keyword) query.keyword = params.keyword
  if (params.username) query.username = params.username
  if (params.tokenName) query.token_name = params.tokenName
  if (params.page) query.page = String(params.page)
  if (params.pageSize) query.page_size = String(params.pageSize)
  const res = await api.get<ContentQuestionsResponse>(
    '/api/analytics/content-questions',
    { params: query }
  )
  return res.data
}
