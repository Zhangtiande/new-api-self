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
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

// Exercise the real shared interceptors; only the HTTP transport is replaced.
test('an expired access token refreshes through the project login and retries showcase polling', async () => {
  vi.resetModules()
  const { default: axios, AxiosError } = await import('axios')
  const previousAdapter = axios.defaults.adapter
  const calls: Array<{
    url?: string
    authorization: unknown
    credentials?: boolean
  }> = []
  const bundle = {
    access_token: 'refreshed-test-token',
    token_type: 'Bearer',
    access_expires_at: Math.floor(Date.now() / 1000) + 600,
    user: { id: 1, username: 'test-admin', role: 10 },
    session: {
      sid: 'test-showcase-session',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'test',
      created_at: 1,
      last_active_at: 1,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  }
  const response = (
    config: InternalAxiosRequestConfig,
    data: unknown,
    status = 200
  ) => ({ config, data, status, statusText: String(status), headers: {} })
  const transport: AxiosAdapter = async (config) => {
    calls.push({
      url: config.url,
      authorization: config.headers.Authorization,
      credentials: config.withCredentials,
    })
    if (config.url === '/api/user/auth/refresh') {
      return response(config, { success: true, data: bundle })
    }
    if (
      config.url === '/api/showcase/live' &&
      config.headers.Authorization === 'Bearer refreshed-test-token'
    ) {
      return response(config, {
        success: true,
        data: { current: { asOf: '2026-11-02T00:00:00Z', inFlight: 4 } },
      })
    }
    throw new AxiosError(
      'Expired test access token',
      'ERR_BAD_REQUEST',
      config,
      undefined,
      response(config, {}, 401)
    )
  }
  axios.defaults.adapter = transport
  const { useAuthStore } = await import('@/stores/auth-store')
  useAuthStore
    .getState()
    .auth.setBundle({ ...bundle, access_token: 'expired-test-token' })
  const { getShowcaseCurrent } = await import('../api')
  try {
    const data = await getShowcaseCurrent()
    expect(data.inFlight).toBe(4)
    expect(calls.map((call) => call.url)).toEqual([
      '/api/showcase/live',
      '/api/user/auth/refresh',
      '/api/showcase/live',
    ])
    expect(calls[0].authorization).toBe('Bearer expired-test-token')
    expect(calls[2].authorization).toBe('Bearer refreshed-test-token')
    expect(calls.every((call) => call.credentials === true)).toBe(true)
    expect(useAuthStore.getState().auth.accessToken).toBe(
      'refreshed-test-token'
    )
  } finally {
    axios.defaults.adapter = previousAdapter
    useAuthStore.getState().auth.reset()
  }
})
afterEach(() => {
  vi.resetModules()
})
