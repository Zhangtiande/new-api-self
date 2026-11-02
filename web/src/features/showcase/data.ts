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

import type {
  ShowcaseApplication,
  ShowcaseApplicationModel,
  ShowcaseApplicationStory,
  ShowcaseDay,
  ShowcaseLiveModel,
  ShowcaseModel,
  ShowcaseSceneDefinition,
  ShowcaseSceneId,
  ShowcaseSnapshot,
  ShowcaseUsage,
} from './types'

// These editorial values are translation keys; application and model names remain source identities.
export const sceneDefinitions: ShowcaseSceneDefinition[] = [
  {
    id: 'development',
    name: 'Research and engineering',
    color: '#66d9c4',
    note: 'Model applications in coding tools, research and engineering workflows',
  },
  {
    id: 'business',
    name: 'Production and business',
    color: '#83b4ed',
    note: 'Model applications in production management, business platforms and professional workflows',
  },
  {
    id: 'knowledge',
    name: 'Knowledge and collaboration',
    color: '#a3a8e7',
    note: 'Knowledge interaction, retrieval, meetings and content organization',
  },
  {
    id: 'content',
    name: 'Content and interaction',
    color: '#d0b78b',
    note: 'Content creation, digital humans and interactive services',
  },
  {
    id: 'integration',
    name: 'Platforms and integration',
    color: '#87b9c3',
    note: 'Model access, platform applications and integration validation',
  },
]

const stories: Record<string, ShowcaseApplicationStory> = {
  'A1-Gentis': {
    scene: 'business',
    headline: 'Enterprise intelligence platform',
    description:
      'A unified model entry point provides multiple model services for enterprise applications, with usage attributed to each application.',
    tags: ['Enterprise applications', 'Multiple models', 'Unified access'],
    featured: 1,
  },
  代码辅助: {
    scene: 'development',
    headline: 'AI in development workflows',
    description:
      'Model services support coding assistance, allowing development tools to call general, reasoning and coding models on demand.',
    tags: ['Coding assistance', 'Development tools', 'Model services'],
    featured: 2,
  },
  会议纪要平台: {
    scene: 'knowledge',
    headline: 'Meeting content enters knowledge workflows',
    description:
      'Model services support meeting content organization and minutes generation, connecting daily collaboration with enterprise knowledge.',
    tags: [
      'Meeting collaboration',
      'Content organization',
      'Knowledge accumulation',
    ],
    featured: 3,
  },
  'GPT-WEB': {
    scene: 'knowledge',
    headline: 'An intelligent interface for business users',
    description:
      'A unified interaction entry point connects model services for everyday questions and knowledge interaction.',
    tags: ['Knowledge interaction', 'Unified entry point', 'Model calls'],
    featured: 4,
  },
  'YMSM-3S': {
    scene: 'business',
    headline: 'Intelligent services in professional business',
    description:
      'Model calls are integrated into professional applications, with actual service scale and model usage shown by application.',
    tags: [
      'Professional business',
      'Application integration',
      'Multiple model services',
    ],
    featured: 5,
  },
  GIMAC: {
    scene: 'business',
    headline: 'Model capabilities in business applications',
    description:
      'Standard interfaces provide model services for professional applications and connect business systems with computing capabilities.',
    tags: [
      'Business applications',
      'Standard interfaces',
      'Computing services',
    ],
    featured: 6,
  },
  数字人: {
    scene: 'content',
    headline: 'Model services for digital human interaction',
    description:
      'Model calls support digital human applications, connecting content interaction with intelligent services.',
    tags: ['Digital humans', 'Content interaction', 'Model calls'],
    featured: 7,
  },
  生试进度管理: {
    scene: 'business',
    headline: 'Intelligent applications in management workflows',
    description:
      'Model services support trial production progress management, connecting a specific management workflow with intelligent capabilities.',
    tags: [
      'Progress management',
      'Professional workflows',
      'Business applications',
    ],
    featured: 8,
  },
}

export function describeApplication(name: string): ShowcaseApplicationStory {
  if (Object.hasOwn(stories, name)) return stories[name]
  let scene: ShowcaseSceneId = 'integration'
  if (/代码|开发支援|Copilot/i.test(name)) scene = 'development'
  else if (/人事|日计|工事|IoT|流转/i.test(name)) scene = 'business'
  else if (/GPT|纪要|搜索|文档|翻译/i.test(name)) scene = 'knowledge'
  else if (/数字人|图片|文生图|PPT|3D/i.test(name)) scene = 'content'
  return {
    scene,
    headline: 'Model services for practical business scenarios',
    description:
      'Applications call model services through a unified entry point. Usage, active days and model relationships below come from recorded calls.',
    tags: [
      sceneDefinitions.find((item) => item.id === scene)?.name ??
        'Platforms and integration',
      'Unified model services',
    ],
    featured: 99,
  }
}

export function modelType(name: string): string {
  if (name === 'Unclassified model') return 'Unclassified model'
  if (/rerank/i.test(name)) return 'Reranking service'
  if (/embedding|bge/i.test(name)) return 'Embedding service'
  if (/whisper/i.test(name)) return 'Speech service'
  if (/coder/i.test(name)) return 'Coding service'
  if (/thinking/i.test(name)) return 'Reasoning mode'
  return 'General model service'
}

export function modelFamilyId(name: string): string | null {
  const candidate = name.trim().toLowerCase()
  if (!/^gentis(?:-|$)/.test(candidate)) return null
  return candidate.replace(/-thinking$/, '')
}

export function normalizeGentisUsageModels(
  models: ShowcaseApplicationModel[]
): ShowcaseApplicationModel[] {
  const families = new Map<string, ShowcaseApplicationModel>()
  for (const model of models) {
    const id = modelFamilyId(model.id)
    if (!id) continue
    const family = families.get(id) ?? { id, tokens: 0, requests: 0 }
    family.tokens += model.tokens
    family.requests += model.requests
    families.set(id, family)
  }
  return [...families.values()].sort(
    (a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id)
  )
}

export function normalizeGentisPlatformModels(
  models: ShowcaseModel[]
): ShowcaseModel[] {
  const applications = new Map<string, Set<string>>()
  for (const model of models) {
    const id = modelFamilyId(model.id)
    if (!id) continue
    const ids = applications.get(id) ?? new Set<string>()
    for (const applicationId of model.applicationIds) ids.add(applicationId)
    applications.set(id, ids)
  }
  return normalizeGentisUsageModels(models).map((model) => ({
    ...model,
    type: 'Gentis model family',
    applicationIds: [...(applications.get(model.id) ?? [])].sort(),
  }))
}

function sumKnownMetrics(values: Array<number | null>): number | null {
  let total = 0
  for (const value of values) {
    if (value === null || !Number.isFinite(value) || value < 0) return null
    total += value
  }
  return Number.isFinite(total) ? total : null
}

export function normalizeGentisLiveModels(
  models: ShowcaseLiveModel[]
): ShowcaseLiveModel[] {
  const families = new Map<string, ShowcaseLiveModel[]>()
  for (const model of models) {
    const id = modelFamilyId(model.id)
    if (!id) continue
    const members = families.get(id) ?? []
    members.push(model)
    families.set(id, members)
  }
  return [...families]
    .map(([id, members]) => {
      const inFlight = sumKnownMetrics(members.map((model) => model.inFlight))
      const generating = sumKnownMetrics(
        members.map((model) => model.generating)
      )
      if (inFlight === null || generating === null) {
        throw new Error('Invalid Gentis model counts')
      }
      const observations = members.filter((model) => model.generating > 0)
      const weightedTTFT = sumKnownMetrics(
        observations.map((model) =>
          model.observedTTFTMs === null
            ? null
            : model.observedTTFTMs * model.generating
        )
      )
      const observedTTFTMs =
        generating > 0 && weightedTTFT !== null
          ? weightedTTFT / generating
          : null
      const ages = members.map((model) => model.maxAgeMs)
      return {
        id,
        inFlight,
        generating,
        prefilling: sumKnownMetrics(members.map((model) => model.prefilling)),
        promptTokens: sumKnownMetrics(
          members.map((model) => model.promptTokens)
        ),
        maxAgeMs:
          sumKnownMetrics(ages) === null
            ? null
            : Math.max(...ages.filter((age): age is number => age !== null)),
        observedTTFTMs,
      }
    })
    .sort((a, b) => b.inFlight - a.inFlight || a.id.localeCompare(b.id))
}

type ApplicationAccumulator = Omit<
  ShowcaseApplication,
  'models' | 'days' | 'activeDays'
> & {
  models: Map<string, ShowcaseApplicationModel>
  days: Map<string, ShowcaseDay>
}
type ModelAccumulator = Omit<ShowcaseModel, 'applicationIds'> & {
  applicationIds: Set<string>
}

export function aggregateUsage(
  snapshot: ShowcaseSnapshot,
  range = 30
): ShowcaseUsage {
  if (!Number.isSafeInteger(range) || range < 1) {
    throw new Error('Invalid showcase date range')
  }
  const cutoff = new Date(`${snapshot.lastDay}T00:00:00Z`)
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error('Invalid showcase date')
  }
  cutoff.setUTCDate(cutoff.getUTCDate() - range + 1)
  const firstDay = cutoff.toISOString().slice(0, 10)
  const apps = new Map<string, ApplicationAccumulator>()
  const models = new Map<string, ModelAccumulator>()
  const days = new Map<string, ShowcaseDay>()
  let tokens = 0,
    requests = 0,
    unassignedTokens = 0,
    unassignedRequests = 0

  for (const row of snapshot.rows) {
    if (row.day < firstDay || row.day > snapshot.lastDay) continue
    if (
      !Number.isSafeInteger(row.tokens) ||
      row.tokens < 0 ||
      !Number.isSafeInteger(row.requests) ||
      row.requests < 0
    ) {
      throw new Error('Invalid showcase usage')
    }
    tokens += row.tokens
    requests += row.requests
    if (!Number.isSafeInteger(tokens) || !Number.isSafeInteger(requests)) {
      throw new Error('Showcase usage exceeds numeric precision')
    }
    if (row.applicationId === 'unassigned') {
      unassignedTokens += row.tokens
      unassignedRequests += row.requests
    } else {
      // The server owns canonical identity and privacy filtering; names never recreate an ID.
      const app = apps.get(row.applicationId) ?? {
        id: row.applicationId,
        name: row.name,
        ...describeApplication(row.name),
        tokens: 0,
        requests: 0,
        models: new Map<string, ShowcaseApplicationModel>(),
        days: new Map<string, ShowcaseDay>(),
      }
      app.tokens += row.tokens
      app.requests += row.requests
      const appModel = app.models.get(row.model) ?? {
        id: row.model,
        tokens: 0,
        requests: 0,
      }
      appModel.tokens += row.tokens
      appModel.requests += row.requests
      app.models.set(row.model, appModel)
      const appDay = app.days.get(row.day) ?? {
        day: row.day,
        tokens: 0,
        requests: 0,
      }
      appDay.tokens += row.tokens
      appDay.requests += row.requests
      app.days.set(row.day, appDay)
      apps.set(app.id, app)
    }
    const model = models.get(row.model) ?? {
      id: row.model,
      type: modelType(row.model),
      tokens: 0,
      requests: 0,
      applicationIds: new Set<string>(),
    }
    model.tokens += row.tokens
    model.requests += row.requests
    if (row.applicationId !== 'unassigned') {
      model.applicationIds.add(row.applicationId)
    }
    models.set(model.id, model)
    const day = days.get(row.day) ?? { day: row.day, tokens: 0, requests: 0 }
    day.tokens += row.tokens
    day.requests += row.requests
    days.set(row.day, day)
  }

  const applications: ShowcaseApplication[] = [...apps.values()]
    .map((app) => ({
      ...app,
      models: [...app.models.values()].sort(
        (a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id)
      ),
      days: [...app.days.values()].sort((a, b) => a.day.localeCompare(b.day)),
      activeDays: app.days.size,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id))
  const scenes = sceneDefinitions
    .map((scene) => {
      const members = applications.filter((app) => app.scene === scene.id)
      return {
        ...scene,
        tokens: members.reduce((sum, app) => sum + app.tokens, 0),
        requests: members.reduce((sum, app) => sum + app.requests, 0),
        applications: members.length,
      }
    })
    .filter((scene) => scene.applications > 0)
  return {
    tokens,
    requests,
    unassignedTokens,
    unassignedRequests,
    firstDay,
    lastDay: snapshot.lastDay,
    applications,
    scenes,
    models: [...models.values()]
      .map((model) => ({ ...model, applicationIds: [...model.applicationIds] }))
      .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id)),
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}

export function formatAmount(
  value: number,
  kind = 'tokens'
): { value: string; unit: string } {
  if (!Number.isFinite(value) || value < 0) return { value: '—', unit: '' }
  const scales = [
    { divisor: 1e9, unit: 'B' },
    { divisor: 1e6, unit: 'M' },
    { divisor: 1e3, unit: 'K' },
  ]
  const scale = scales.find((item) => value >= item.divisor)
  const suffix = kind === 'requests' ? 'requests' : ''
  if (scale) {
    return {
      value: (value / scale.divisor).toFixed(
        value / scale.divisor < 10 ? 2 : 1
      ),
      unit: suffix ? `${scale.unit} ${suffix}` : scale.unit,
    }
  }
  return {
    value: new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
    }).format(value),
    unit: suffix,
  }
}
