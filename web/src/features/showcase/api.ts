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

import type { ShowcaseCurrent, ShowcaseOverview } from './types'

type Response<T> = { success: boolean; data?: T; message?: string }

export async function getShowcaseSnapshot(
  signal?: AbortSignal
): Promise<ShowcaseOverview> {
  const response = await api.get<Response<ShowcaseOverview>>('/api/showcase', {
    signal,
    timeout: 20000,
    skipErrorHandler: true,
  })
  if (!response.data.success || !response.data.data?.snapshot) {
    throw new Error('Showcase snapshot unavailable')
  }
  return response.data.data
}

export async function getShowcaseCurrent(
  signal?: AbortSignal
): Promise<ShowcaseCurrent> {
  const response = await api.get<Response<{ current: ShowcaseCurrent }>>(
    '/api/showcase/live',
    { signal, timeout: 10000, skipErrorHandler: true }
  )
  if (!response.data.success || !response.data.data?.current) {
    throw new Error('Showcase live data unavailable')
  }
  return response.data.data.current
}
