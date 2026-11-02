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
import { describe, expect, test } from 'vitest'

import {
  aggregateUsage,
  describeApplication,
  formatAmount,
  modelFamilyId,
  modelType,
  normalizeGentisLiveModels,
  normalizeGentisPlatformModels,
  normalizeGentisUsageModels,
} from '../data'
import type {
  ShowcaseApplicationModel,
  ShowcaseLiveModel,
  ShowcaseSnapshot,
} from '../types'

const snapshot: ShowcaseSnapshot = {
  asOf: '2026-11-01T16:10:00Z',
  latestBucket: '2026-11-01T16:00:00Z',
  source: 'gateway',
  granularity: 'hourly',
  firstDay: '2026-10-30',
  lastDay: '2026-11-02',
  rows: [
    {
      applicationId: 'app:代码辅助',
      name: '代码辅助',
      model: 'code-coder',
      bucket: 1793548800,
      day: '2026-11-02',
      tokens: 100,
      requests: 1,
    },
    {
      applicationId: 'app:代码辅助',
      name: '代码辅助',
      model: 'code-coder',
      bucket: 1793552400,
      day: '2026-11-02',
      tokens: 300,
      requests: 3,
    },
    {
      applicationId: 'app:代码辅助',
      name: '代码辅助',
      model: 'general',
      bucket: 1793462400,
      day: '2026-11-01',
      tokens: 50,
      requests: 1,
    },
    {
      applicationId: 'app:yCopilot',
      name: 'yCopilot',
      model: 'code-coder',
      bucket: 1793548800,
      day: '2026-11-02',
      tokens: 25,
      requests: 1,
    },
    {
      applicationId: 'unassigned',
      name: 'Unassigned application',
      model: 'Unclassified model',
      bucket: 1793548800,
      day: '2026-11-02',
      tokens: 20,
      requests: 2,
    },
    {
      applicationId: 'app:会议纪要平台',
      name: '会议纪要平台',
      model: 'general',
      bucket: 1793289600,
      day: '2026-10-30',
      tokens: 10,
      requests: 1,
    },
  ],
}

describe('showcase history aggregation', () => {
  test('hourly rows sharing a canonical application sum without duplicating application, model or active-day coverage', () => {
    const usage = aggregateUsage(snapshot, 3)
    expect(usage.tokens).toBe(495)
    expect(usage.requests).toBe(8)
    expect(usage.applications).toHaveLength(2)
    expect(usage.applications[0]).toMatchObject({
      id: 'app:代码辅助',
      tokens: 450,
      requests: 5,
      activeDays: 2,
    })
    expect(usage.applications[0].models).toEqual([
      { id: 'code-coder', tokens: 400, requests: 4 },
      { id: 'general', tokens: 50, requests: 1 },
    ])
    expect(usage.applications[0].days).toEqual([
      { day: '2026-11-01', tokens: 50, requests: 1 },
      { day: '2026-11-02', tokens: 400, requests: 4 },
    ])
    expect(usage.scenes).toEqual([
      expect.objectContaining({
        id: 'development',
        applications: 2,
        tokens: 475,
        requests: 6,
      }),
    ])
    expect(
      usage.models.find((model) => model.id === 'code-coder')?.applicationIds
    ).toEqual(['app:代码辅助', 'app:yCopilot'])
  })

  test('unassigned identity remains in global, model and daily totals without becoming an application or domain', () => {
    const usage = aggregateUsage(snapshot, 1)
    expect(usage).toMatchObject({
      tokens: 445,
      requests: 7,
      unassignedTokens: 20,
      unassignedRequests: 2,
      firstDay: '2026-11-02',
    })
    expect(
      usage.applications.some((app) => app.name === 'Unassigned application')
    ).toBe(false)
    expect(
      usage.models.find((model) => model.id === 'Unclassified model')
    ).toEqual({
      id: 'Unclassified model',
      type: 'Unclassified model',
      tokens: 20,
      requests: 2,
      applicationIds: [],
    })
    expect(usage.days).toEqual([
      { day: '2026-11-02', tokens: 445, requests: 7 },
    ])
  })

  test('the server Shanghai calendar day controls the window even when collection UTC date is the previous day', () => {
    expect(aggregateUsage(snapshot, 1).applications[0].tokens).toBe(400)
    expect(aggregateUsage(snapshot, 3).firstDay).toBe('2026-10-31')
    expect(
      aggregateUsage(snapshot, 4).applications.find(
        (app) => app.name === '会议纪要平台'
      )?.tokens
    ).toBe(10)
  })

  test('empty history returns no invented application, domain or daily records', () => {
    expect(aggregateUsage({ ...snapshot, rows: [] }, 7)).toEqual({
      tokens: 0,
      requests: 0,
      unassignedTokens: 0,
      unassignedRequests: 0,
      firstDay: '2026-10-27',
      lastDay: '2026-11-02',
      applications: [],
      scenes: [],
      models: [],
      days: [],
    })
  })

  test('invalid usage and totals beyond integer precision cannot render as exact usage', () => {
    expect(() =>
      aggregateUsage({
        ...snapshot,
        rows: [{ ...snapshot.rows[0], tokens: -1 }],
      })
    ).toThrow('Invalid showcase usage')
    expect(() =>
      aggregateUsage({
        ...snapshot,
        rows: [
          { ...snapshot.rows[0], tokens: Number.MAX_SAFE_INTEGER },
          snapshot.rows[1],
        ],
      })
    ).toThrow('numeric precision')
  })
})

describe('showcase editorial classification and formatting', () => {
  test('known product stories and generic naming rules organize domains without merging distinct products', () => {
    expect(describeApplication('代码辅助')).toMatchObject({
      scene: 'development',
      featured: 2,
    })
    expect(describeApplication('yCopilotV1').scene).toBe('development')
    expect(describeApplication('开发利用').scene).toBe('integration')
    expect(describeApplication('人事服务').scene).toBe('business')
    expect(describeApplication('文档检索').scene).toBe('knowledge')
    expect(describeApplication('3D 应用').scene).toBe('content')
    expect(modelType('general-thinking')).toBe('Reasoning mode')
    expect(modelType('bge-reranker-v2-m3')).toBe('Reranking service')
  })

  test('compact quantities preserve known zero and distinguish request units from unknown values', () => {
    expect(formatAmount(0)).toEqual({ value: '0', unit: '' })
    expect(formatAmount(1_250_000, 'requests')).toEqual({
      value: '1.25',
      unit: 'M requests',
    })
    expect(formatAmount(1_250_000_000)).toEqual({ value: '1.25', unit: 'B' })
    expect(formatAmount(Number.NaN)).toEqual({ value: '—', unit: '' })
  })
})

describe('Gentis-only relationship views', () => {
  test('case-insensitive Gentis boundaries combine only the thinking suffix and preserve lite as a separate family', () => {
    expect(modelFamilyId('Gentis-Thinking')).toBe('gentis')
    expect(modelFamilyId(' GENTIS-LITE-thinking ')).toBe('gentis-lite')
    expect(modelFamilyId('gentis-lite')).toBe('gentis-lite')
    expect(modelFamilyId('gentis-coder')).toBe('gentis-coder')
    expect(modelFamilyId('gentisPlus')).toBeNull()
    expect(modelFamilyId('other-gentis')).toBeNull()
  })

  test('normalizing the application model view leaves all-model application and platform totals unchanged', () => {
    const models: ShowcaseApplicationModel[] = [
      { id: 'gentis', tokens: 100, requests: 1 },
      { id: 'gentis-thinking', tokens: 200, requests: 2 },
      { id: 'gentis-lite', tokens: 400, requests: 4 },
      { id: 'gentis-lite-thinking', tokens: 500, requests: 5 },
      { id: 'other-model', tokens: 1000, requests: 10 },
    ]
    const source = {
      ...snapshot,
      rows: models.map((model) => ({
        ...snapshot.rows[0],
        model: model.id,
        tokens: model.tokens,
        requests: model.requests,
      })),
    }
    const usage = aggregateUsage(source, 1)
    const app = usage.applications[0]
    expect(normalizeGentisUsageModels(app.models)).toEqual([
      { id: 'gentis-lite', tokens: 900, requests: 9 },
      { id: 'gentis', tokens: 300, requests: 3 },
    ])
    expect(app).toMatchObject({ tokens: 2200, requests: 22 })
    expect(usage).toMatchObject({ tokens: 2200, requests: 22 })
    expect(app.models).toHaveLength(5)
    expect(usage.models).toHaveLength(5)
    expect(aggregateUsage(source, 1)).toEqual(usage)
  })

  test('platform families include global usage and union applications without duplicating thinking relationships', () => {
    const families = normalizeGentisPlatformModels([
      {
        id: 'gentis',
        type: 'General model service',
        tokens: 100,
        requests: 1,
        applicationIds: ['app:a'],
      },
      {
        id: 'gentis-thinking',
        type: 'Reasoning mode',
        tokens: 500,
        requests: 5,
        applicationIds: ['app:b', 'app:a'],
      },
      {
        id: 'gentis-lite-thinking',
        type: 'Reasoning mode',
        tokens: 20,
        requests: 2,
        applicationIds: [],
      },
      {
        id: 'other-model',
        type: 'General model service',
        tokens: 1000,
        requests: 10,
        applicationIds: ['app:c'],
      },
    ])
    expect(families).toEqual([
      {
        id: 'gentis',
        type: 'Gentis model family',
        tokens: 600,
        requests: 6,
        applicationIds: ['app:a', 'app:b'],
      },
      {
        id: 'gentis-lite',
        type: 'Gentis model family',
        tokens: 20,
        requests: 2,
        applicationIds: [],
      },
    ])
  })

  test('live families sum stages and context and weight first-token time by responses already started', () => {
    const models: ShowcaseLiveModel[] = [
      {
        id: 'gentis',
        inFlight: 2,
        generating: 1,
        prefilling: 1,
        promptTokens: 10,
        maxAgeMs: 50,
        observedTTFTMs: 100,
      },
      {
        id: 'Gentis-thinking',
        inFlight: 3,
        generating: 3,
        prefilling: 0,
        promptTokens: 20,
        maxAgeMs: 200,
        observedTTFTMs: 500,
      },
      {
        id: 'gentis-lite',
        inFlight: 2,
        generating: 0,
        prefilling: 2,
        promptTokens: 7,
        maxAgeMs: 10,
        observedTTFTMs: null,
      },
      {
        id: 'other-model',
        inFlight: 40,
        generating: 40,
        prefilling: 0,
        promptTokens: 1000,
        maxAgeMs: 1000,
        observedTTFTMs: 2000,
      },
    ]
    expect(normalizeGentisLiveModels(models)).toEqual([
      {
        id: 'gentis',
        inFlight: 5,
        generating: 4,
        prefilling: 1,
        promptTokens: 30,
        maxAgeMs: 200,
        observedTTFTMs: 400,
      },
      {
        id: 'gentis-lite',
        inFlight: 2,
        generating: 0,
        prefilling: 2,
        promptTokens: 7,
        maxAgeMs: 10,
        observedTTFTMs: null,
      },
    ])
    expect(models[1].id).toBe('Gentis-thinking')
    expect(models).toHaveLength(4)
  })

  test('unknown contributing metrics stay unknown while a model without a response adds no TTFT weight', () => {
    expect(
      normalizeGentisLiveModels([
        {
          id: 'gentis',
          inFlight: 1,
          generating: 1,
          prefilling: 0,
          promptTokens: 10,
          maxAgeMs: 50,
          observedTTFTMs: 100,
        },
        {
          id: 'gentis-thinking',
          inFlight: 1,
          generating: 1,
          prefilling: null,
          promptTokens: null,
          maxAgeMs: null,
          observedTTFTMs: null,
        },
        {
          id: 'gentis-lite',
          inFlight: 1,
          generating: 1,
          prefilling: 0,
          promptTokens: 5,
          maxAgeMs: 10,
          observedTTFTMs: 80,
        },
        {
          id: 'gentis-lite-thinking',
          inFlight: 1,
          generating: 0,
          prefilling: 1,
          promptTokens: 0,
          maxAgeMs: 10,
          observedTTFTMs: null,
        },
      ])
    ).toEqual([
      {
        id: 'gentis',
        inFlight: 2,
        generating: 2,
        prefilling: null,
        promptTokens: null,
        maxAgeMs: null,
        observedTTFTMs: null,
      },
      {
        id: 'gentis-lite',
        inFlight: 2,
        generating: 1,
        prefilling: 1,
        promptTokens: 5,
        maxAgeMs: 10,
        observedTTFTMs: 80,
      },
    ])
  })

  test('empty model sources create no invented Gentis family', () => {
    expect(normalizeGentisUsageModels([])).toEqual([])
    expect(normalizeGentisPlatformModels([])).toEqual([])
    expect(normalizeGentisLiveModels([])).toEqual([])
  })
})
