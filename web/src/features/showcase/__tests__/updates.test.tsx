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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { ShowcaseDashboard } from '../index'
import type { ShowcaseCurrent, ShowcaseSnapshot } from '../types'

const source = vi.hoisted(() => ({ history: vi.fn(), current: vi.fn() }))
vi.mock('../api', () => ({
  getShowcaseSnapshot: source.history,
  getShowcaseCurrent: source.current,
}))

const day = new Date(Date.now() + 28800000).toISOString().slice(0, 10)
const snapshot: ShowcaseSnapshot = {
  asOf: new Date().toISOString(),
  latestBucket: new Date().toISOString(),
  source: 'gateway',
  granularity: 'hourly',
  firstDay: day,
  lastDay: day,
  rows: [
    {
      applicationId: 'app:代码辅助',
      name: '代码辅助',
      model: 'gentis',
      day,
      bucket: 1,
      tokens: 1200,
      requests: 12,
    },
    {
      applicationId: 'app:A1-Gentis',
      name: 'A1-Gentis',
      model: 'gentis',
      day,
      bucket: 1,
      tokens: 800,
      requests: 8,
    },
  ],
}
function live(): ShowcaseCurrent {
  return {
    asOf: new Date().toISOString(),
    validUntil: new Date(Date.now() + 18000).toISOString(),
    status: 'available',
    sourceType: 'gateway',
    gatewayAvailable: true,
    inFlight: 3,
    generating: 2,
    promptTokens: 8000,
    prefilling: 1,
    activeModels: 1,
    recognizedApps: 1,
    applications: [
      {
        id: 'app:代码辅助',
        name: '代码辅助',
        inFlight: 3,
        prefilling: 1,
        promptTokens: 8000,
        maxAgeMs: 5000,
      },
    ],
    models: [
      {
        id: 'gentis',
        inFlight: 3,
        generating: 2,
        prefilling: 1,
        promptTokens: 8000,
        maxAgeMs: 5000,
        observedTTFTMs: 200,
      },
    ],
    engines: [],
    freshEngineCount: 0,
    inputTokensPerSecond: null,
    outputTokensPerSecond: null,
    cacheReuseRatio: null,
    activeTokens: null,
    cachedTokens: null,
    freeTokens: null,
    capacityTokens: null,
  }
}
let queryClient: QueryClient
beforeEach(() => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'local-test', role: 10 })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '')
    },
  })
  source.history.mockResolvedValue({
    snapshot,
    lifetime: {
      asOf: snapshot.asOf,
      firstDay: '2025-09-18',
      lastDay: day,
      tokens: 78000000000,
      requests: 2950000,
      applications: 24,
      models: 64,
    },
  })
  source.current.mockResolvedValue(live())
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
})
afterEach(() => {
  queryClient.clear()
  useAuthStore.getState().auth.reset()
  vi.resetAllMocks()
})

async function mount() {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/showcase',
    component: ShowcaseDashboard,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/showcase'] }),
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', {
    name: 'Xiamen AI applications and compute services',
  })
  return result
}

test('domain selection filters applications and never offers a department grouping', async () => {
  await mount()
  const user = userEvent.setup()
  await screen.findByRole('button', {
    name: /代码辅助.*AI in development workflows/,
  })
  await user.click(
    screen.getByRole('button', { name: 'Research and engineering' })
  )
  expect(screen.getByTestId('case-title')).toHaveTextContent('代码辅助')
  await user.click(
    screen.getByRole('button', {
      name: /代码辅助.*AI in development workflows/,
    })
  )
  expect(
    screen.queryByRole('button', { name: /By department|按团队|按部门/ })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Research and engineering' })
  ).toHaveAttribute('aria-pressed', 'true')
})

test('a transient live read failure retains the last successful numbers and subsequent success updates them', async () => {
  await mount()
  await screen.findByText('Live service sampling')
  source.current.mockRejectedValueOnce(new Error('temporary network outage'))
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['showcase', 'live'] })
  })
  expect(screen.getByText('Live service sampling')).toBeInTheDocument()
  expect(screen.getByTestId('case-title')).toHaveTextContent('A1-Gentis')
  const next = live()
  next.inFlight = 7
  source.current.mockResolvedValueOnce(next)
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['showcase', 'live'] })
  })
  const overview = screen.getByRole('region', { name: 'Live service overview' })
  await waitFor(() => expect(overview).toHaveTextContent('7'))
})

test('an expired sample stops current activity and retains a dated last reading', async () => {
  const old = live()
  old.asOf = new Date(Date.now() - 25000).toISOString()
  old.validUntil = new Date(Date.now() - 7000).toISOString()
  source.current.mockResolvedValue(old)
  await mount()
  await screen.findByText('Reconnecting to live services')
  await waitFor(() =>
    expect(
      screen.getByText(/Last successful sample .*retrying/)
    ).toBeInTheDocument()
  )
  expect(
    screen.getByRole('region', { name: 'Live service overview' })
  ).toHaveTextContent('3')
  expect(screen.queryByText('3 requests in service')).not.toBeInTheDocument()
})

test('non-admin accounts cannot start showcase data polling', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'regular-test', role: 1 })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/showcase',
    component: ShowcaseDashboard,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/showcase'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: 'Administrator access required' })
  expect(source.history).not.toHaveBeenCalled()
  expect(source.current).not.toHaveBeenCalled()
})

test('project Chinese language codes render date formats without crashing', async () => {
  const { default: i18next } = await import('i18next')
  try {
    await i18next.changeLanguage('zhCN')
    await mount()
    expect(
      screen.getByRole('heading', {
        name: 'Xiamen AI applications and compute services',
      })
    ).toBeInTheDocument()
  } finally {
    await i18next.changeLanguage('en')
  }
})

test('a server permission rejection hides previously cached administrator data', async () => {
  await mount()
  await screen.findByText('Live service sampling')
  source.current.mockRejectedValueOnce(
    Object.assign(new Error('Forbidden'), {
      isAxiosError: true,
      response: { status: 403 },
    })
  )
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['showcase', 'live'] })
  })
  await screen.findByRole('heading', { name: 'Administrator access required' })
  expect(screen.queryByTestId('case-title')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Live service overview' })
  ).not.toBeInTheDocument()
})

test('the flow combines Gentis variants while platform totals retain every model', async () => {
  const mixed = {
    ...snapshot,
    rows: [
      ...snapshot.rows,
      {
        applicationId: 'app:A1-Gentis',
        name: 'A1-Gentis',
        model: 'gentis-thinking',
        day,
        bucket: 1,
        tokens: 600,
        requests: 6,
      },
      {
        applicationId: 'app:A1-Gentis',
        name: 'A1-Gentis',
        model: 'qwen3-coder',
        day,
        bucket: 1,
        tokens: 900,
        requests: 9,
      },
    ],
  }
  source.history.mockResolvedValue({
    snapshot: mixed,
    lifetime: {
      asOf: snapshot.asOf,
      firstDay: '2025-09-18',
      lastDay: day,
      tokens: 78000000000,
      requests: 2950000,
      applications: 24,
      models: 64,
    },
  })
  const current = live()
  current.inFlight = 6
  current.generating = 5
  current.activeModels = 3
  current.promptTokens = 13000
  current.models = [
    ...current.models,
    {
      id: 'gentis-thinking',
      inFlight: 2,
      generating: 2,
      prefilling: 0,
      promptTokens: 4000,
      maxAgeMs: 1000,
      observedTTFTMs: 1000,
    },
    {
      id: 'qwen3-coder',
      inFlight: 1,
      generating: 1,
      prefilling: 0,
      promptTokens: 1000,
      maxAgeMs: 1000,
      observedTTFTMs: 400,
    },
  ]
  source.current.mockResolvedValue(current)
  const { container } = await mount()
  await waitFor(() =>
    expect(container.querySelectorAll('.network-node.model-node')).toHaveLength(
      1
    )
  )
  expect(container.querySelector('.network-node.model-node')).toHaveTextContent(
    'gentis'
  )
  expect(
    container.querySelector('.network-node.model-node')
  ).not.toHaveTextContent('thinking')
  expect(
    container.querySelector('.network-node.model-node')
  ).not.toHaveTextContent('qwen')
  expect(container.querySelector('.network-node.model-node')).toHaveTextContent(
    '5 in flight'
  )
  expect(container.querySelector('.overview-metric')).toHaveTextContent('6')
  expect(container.querySelectorAll('.overview-metric')[2]).toHaveTextContent(
    '3'
  )
  expect(container.querySelector('.case-facts')).toHaveTextContent('2.30')
})

test('all-time totals stay independent when the recent period changes', async () => {
  const { container } = await mount()
  await screen.findByRole('region', { name: 'All-time platform impact' })
  await waitFor(() =>
    expect(screen.getByTestId('lifetime-tokens')).toHaveTextContent('78.0')
  )
  const historical = screen.getByRole('region', {
    name: 'All-time platform impact',
  }).textContent
  await userEvent.setup().click(screen.getByRole('button', { name: '7 days' }))
  expect(
    screen.getByRole('region', { name: 'All-time platform impact' }).textContent
  ).toBe(historical)
  expect(container.querySelector('.history-panel')).toHaveTextContent('2.00')
})
