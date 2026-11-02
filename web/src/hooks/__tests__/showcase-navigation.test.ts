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
import { renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { useSidebarView } from '../use-sidebar-view'

const config = vi.hoisted(() => ({ modules: undefined as string | undefined }))
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => '/dashboard/overview',
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { SidebarModulesAdmin: config.modules } }),
}))

afterEach(() => {
  config.modules = undefined
  useAuthStore.getState().auth.reset()
})

test('administrators can open the showcase directly from root navigation', () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role: 10 })
  const { result } = renderHook(() => useSidebarView())
  const item = result.current.navGroups
    .flatMap((group) => group.items)
    .find((entry) => entry.url === '/dashboard/showcase')
  expect(item?.title).toBe('Business Showcase')
})

test('showcase navigation is hidden for non-administrators', () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role: 1 })
  const { result } = renderHook(() => useSidebarView())
  expect(
    result.current.navGroups
      .flatMap((group) => group.items)
      .some((entry) => entry.url === '/dashboard/showcase')
  ).toBe(false)
})

test('showcase follows the existing console detail visibility setting', () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role: 10 })
  config.modules = JSON.stringify({ console: { enabled: true, detail: false } })
  const { result } = renderHook(() => useSidebarView())
  expect(
    result.current.navGroups
      .flatMap((group) => group.items)
      .some((entry) => entry.url === '/dashboard/showcase')
  ).toBe(false)
})
