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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { isAxiosError } from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getShowcaseCurrent, getShowcaseSnapshot } from './api'
import {
  aggregateUsage,
  sceneDefinitions,
  modelFamilyId,
  normalizeGentisUsageModels,
  normalizeGentisPlatformModels,
  normalizeGentisLiveModels,
} from './data'
import { LifetimeSummary } from './lifetime-summary'
import { LiveTrend } from './live-trend'
import { Amount, Heading, Metric, UsageTrend } from './primitives'
import { ProfessionalPanel } from './professional-panel'
import { ServiceNetwork, type Selection } from './service-network'
import type {
  ShowcaseApplication,
  ShowcaseSample,
  ShowcaseSnapshot,
} from './types'

import './showcase.css'

export function ShowcaseDashboard() {
  const { t, i18n } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role)
  const sid = useAuthStore((state) => state.auth.session?.sid)
  const isAdmin = Boolean(role && role >= ROLE.ADMIN)
  const [range, setRange] = useState(30)
  const [domain, setDomain] = useState('all')
  const [featuredOnly, setFeaturedOnly] = useState(true)
  const [page, setPage] = useState(0)
  const [modelPage, setModelPage] = useState(0)
  const [selected, setSelected] = useState<Selection>({
    type: 'app',
    id: 'app:A1-Gentis',
  })
  const [touring, setTouring] = useState(true)
  const [coverageMetric, setCoverageMetric] = useState<
    'applications' | 'tokens'
  >('applications')
  const [historyMetric, setHistoryMetric] = useState<'tokens' | 'requests'>(
    'tokens'
  )
  const [historyScope, setHistoryScope] = useState<'platform' | 'case'>(
    'platform'
  )
  const [samples, setSamples] = useState<ShowcaseSample[]>([])
  const [now, setNow] = useState(Date.now)
  const [showSources, setShowSources] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [notice, setNotice] = useState('')
  const screenRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const snapshotQuery = useQuery({
    queryKey: ['showcase', 'history', 'lifetime', sid],
    queryFn: ({ signal }) => getShowcaseSnapshot(signal),
    enabled: isAdmin,
    refetchInterval: 300000,
    refetchIntervalInBackground: true,
    staleTime: 300000,
    retry: 1,
  })
  const liveQuery = useQuery({
    queryKey: ['showcase', 'live', sid],
    queryFn: ({ signal }) => getShowcaseCurrent(signal),
    enabled: isAdmin,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    retry: false,
  })
  const accessDenied = [snapshotQuery.error, liveQuery.error].some(
    (error) => isAxiosError(error) && error.response?.status === 403
  )
  const snapshot = snapshotQuery.data?.snapshot
  const lifetime = snapshotQuery.data?.lifetime
  const today = new Date(now + 28800000).toISOString().slice(0, 10)
  const emptySnapshot = useMemo<ShowcaseSnapshot>(
    () => ({
      asOf: `${today}T00:00:00+08:00`,
      latestBucket: null,
      source: 'gateway',
      granularity: 'hourly',
      firstDay: today,
      lastDay: today,
      rows: [],
    }),
    [today]
  )
  const data = useMemo(
    () => aggregateUsage(snapshot || emptySnapshot, range),
    [snapshot, range, emptySnapshot]
  )
  const lastCurrent = liveQuery.data
  const current =
    lastCurrent?.status === 'available' &&
    now >= Date.parse(lastCurrent.asOf) - 5000 &&
    now < Date.parse(lastCurrent.validUntil)
      ? {
          ...lastCurrent,
          engines: lastCurrent.engines.filter(
            (engine) =>
              now >= Date.parse(engine.asOf) - 5000 &&
              now < Date.parse(engine.validUntil)
          ),
        }
      : null
  const clock = new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const date = new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  })
  const period =
    range === 1 ? t('Today') : t('Last {{count}} days', { count: range })
  const liveApps = new Map(current?.applications.map((item) => [item.id, item]))
  const gentisLive = normalizeGentisLiveModels(current?.models || [])
  const liveModels = new Map(gentisLive.map((item) => [item.id, item]))
  const gentisModels = useMemo(
    () => normalizeGentisPlatformModels(data.models),
    [data.models]
  )
  const featured = data.applications
    .filter((app) => app.featured < 99)
    .sort((a, b) => a.featured - b.featured)
  const tourIds = featured.map((app) => app.id).join('|')
  const selectedModel =
    selected.type === 'model'
      ? gentisModels.find((model) => model.id === selected.id)
      : undefined
  const eligible = data.applications.filter(
    (app) =>
      (!selectedModel || selectedModel.applicationIds.includes(app.id)) &&
      (domain === 'all' || app.scene === domain)
  )
  const candidates = featuredOnly
    ? eligible
        .filter((app) => app.featured < 99)
        .sort((a, b) => a.featured - b.featured)
    : eligible
  const app = selectedModel
    ? undefined
    : eligible.find((item) => item.id === selected.id) ||
      candidates[0] ||
      eligible[0]
  const pages = Math.max(1, Math.ceil(candidates.length / 4))
  const activePage = touring
    ? Math.max(
        0,
        Math.floor(candidates.findIndex((item) => item.id === app?.id) / 4)
      )
    : Math.min(page, pages - 1)
  const visibleApps = candidates.slice(activePage * 4, activePage * 4 + 4)
  const stageLive = selectedModel
    ? liveModels.get(selectedModel.id)
    : liveApps.get(app?.id || '')
  const stageModels = selectedModel
    ? gentisModels
    : normalizeGentisUsageModels(app?.models || [])
  const modelPages = Math.max(1, Math.ceil(stageModels.length / 2))
  const visibleModels = stageModels.slice(
    Math.min(modelPage, modelPages - 1) * 2,
    Math.min(modelPage, modelPages - 1) * 2 + 2
  )
  const relatedApps = selectedModel
    ? data.applications
        .filter((item) => selectedModel.applicationIds.includes(item.id))
        .slice(0, 4)
    : [app, ...featured.filter((item) => item.id !== app?.id)]
        .filter((item): item is ShowcaseApplication => Boolean(item))
        .slice(0, 4)
  const gentisApplications = relatedApps.map((item) => ({
    ...item,
    models: normalizeGentisUsageModels(item.models),
  }))
  const modelIds = [
    ...new Set([
      ...(selectedModel
        ? [selectedModel.id]
        : normalizeGentisUsageModels(app?.models || [])
            .slice(0, 3)
            .map((model) => model.id) || []),
      ...gentisApplications.flatMap((item) =>
        item.models.slice(0, 2).map((model) => model.id)
      ),
    ]),
  ].slice(0, 4)
  const coverage = [...data.scenes].sort(
    (a, b) => b[coverageMetric] - a[coverageMetric]
  )
  const coverageTotal = coverage.reduce((sum, scene) => sum + scene.tokens, 0)
  const caseDays = new Map(app?.days.map((day) => [day.day, day]))
  if (selectedModel && snapshot) {
    for (const row of snapshot.rows) {
      if (
        modelFamilyId(row.model) !== selectedModel.id ||
        row.day < data.firstDay ||
        row.day > data.lastDay
      ) {
        continue
      }
      const day = caseDays.get(row.day) || {
        day: row.day,
        tokens: 0,
        requests: 0,
      }
      day.tokens += row.tokens
      day.requests += row.requests
      caseDays.set(row.day, day)
    }
  }
  const historyDays =
    historyScope === 'platform'
      ? data.days
      : data.days.map(
          (day) =>
            caseDays.get(day.day) || { day: day.day, tokens: 0, requests: 0 }
        )
  const inputSources = (current?.engines || []).filter(
    (engine) => engine.inputTokensPerSecond != null
  )
  const outputSources = (current?.engines || []).filter(
    (engine) => engine.outputTokensPerSecond != null
  )
  const reuseSources = (current?.engines || []).filter(
    (engine) =>
      engine.inputTokensPerSecond != null &&
      engine.inputTokensPerSecond > 0 &&
      engine.cacheReuseRatio != null
  )
  const input = inputSources.length
    ? inputSources.reduce(
        (sum, engine) => sum + (engine.inputTokensPerSecond ?? 0),
        0
      )
    : null
  const output = outputSources.length
    ? outputSources.reduce(
        (sum, engine) => sum + (engine.outputTokensPerSecond ?? 0),
        0
      )
    : null
  const reuseInput = reuseSources.reduce(
    (sum, engine) => sum + (engine.inputTokensPerSecond ?? 0),
    0
  )
  const reuse =
    reuseInput > 0
      ? reuseSources.reduce(
          (sum, engine) =>
            sum +
            (engine.cacheReuseRatio ?? 0) * (engine.inputTokensPerSecond ?? 0),
          0
        ) / reuseInput
      : null
  const parallel =
    current?.engines.length &&
    current.engines.every((engine) => engine.runningRequests != null)
      ? current.engines.reduce(
          (sum, engine) => sum + (engine.runningRequests ?? 0),
          0
        )
      : null

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (
      !lastCurrent ||
      lastCurrent.status !== 'available' ||
      Date.now() >= Date.parse(lastCurrent.validUntil)
    ) {
      return
    }
    const sum = (key: 'inputTokensPerSecond' | 'outputTokensPerSecond') => {
      const values = lastCurrent.engines
        .filter(
          (engine) =>
            Date.now() >= Date.parse(engine.asOf) - 5000 &&
            Date.now() < Date.parse(engine.validUntil)
        )
        .map((engine) => engine[key])
        .filter((value): value is number => value != null)
      return values.length
        ? values.reduce((total, value) => total + value, 0)
        : null
    }
    setSamples((previous) => [
      ...previous.filter(
        (point) =>
          Date.parse(point.asOf) > Date.now() - 900000 &&
          point.asOf !== lastCurrent.asOf
      ),
      {
        asOf: lastCurrent.asOf,
        inFlight: lastCurrent.inFlight,
        generating: lastCurrent.generating,
        promptTokens: lastCurrent.promptTokens,
        inputTokensPerSecond: sum('inputTokensPerSecond'),
        outputTokensPerSecond: sum('outputTokensPerSecond'),
      },
    ])
  }, [lastCurrent])
  useEffect(() => {
    if (!touring || !tourIds) return
    const ids = tourIds.split('|')
    const timer = setInterval(() => {
      setSelected((previous) => ({
        type: 'app',
        id: ids[(ids.indexOf(previous.id) + 1) % ids.length],
      }))
      setModelPage(0)
    }, 12000)
    return () => clearInterval(timer)
  }, [touring, tourIds])
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  useEffect(() => {
    if (showSources) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [showSources])

  function chooseApp(item: ShowcaseApplication) {
    setSelected({ type: 'app', id: item.id })
    setTouring(false)
    const targetDomain =
      domain !== 'all' && item.scene === domain ? domain : 'all'
    const targetRows = data.applications.filter(
      (app) => targetDomain === 'all' || app.scene === targetDomain
    )
    setDomain(targetDomain)
    setFeaturedOnly(false)
    setPage(
      Math.max(
        0,
        Math.floor(targetRows.findIndex((app) => app.id === item.id) / 4)
      )
    )
    setModelPage(0)
    setHistoryScope('case')
  }
  function chooseModel(id: string) {
    setSelected({ type: 'model', id })
    setTouring(false)
    setDomain('all')
    setFeaturedOnly(false)
    setPage(0)
    setModelPage(0)
    setHistoryScope('case')
  }
  function chooseDomain(id: string) {
    setDomain(id)
    setFeaturedOnly(false)
    setTouring(false)
    setPage(0)
    setModelPage(0)
    const first = data.applications.find(
      (item) => id === 'all' || item.scene === id
    )
    setSelected({ type: 'app', id: first?.id || '' })
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await screenRef.current?.requestFullscreen()
    } catch {
      setNotice(t('Open this page in a browser window to use full screen'))
    }
  }
  const refresh = () => {
    void snapshotQuery.refetch()
    void liveQuery.refetch()
  }
  if (!isAdmin || accessDenied) {
    return (
      <div className='showcase-screen'>
        <div className='showcase-loading'>
          <h1>{t('Administrator access required')}</h1>
          <Link to='/dashboard/$section' params={{ section: 'overview' }}>
            {t('Return to dashboard')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div ref={screenRef} className='showcase-screen'>
      <main className='dashboard'>
        <header className='masthead'>
          <div className='masthead-bar'>
            <div className='identity'>
              <span className='eyebrow'>XIAMEN · APPLIED INTELLIGENCE</span>
              <h1>{t('Xiamen AI applications and compute services')}</h1>
            </div>
            <div className='header-right'>
              <span className={`source-status ${current ? 'is-current' : ''}`}>
                <i />
                {t(
                  current
                    ? 'Live service sampling'
                    : 'Reconnecting to live services'
                )}
              </span>
              <div className='clock'>
                <strong>{clock.format(new Date(now))}</strong>
                <span>{date.format(new Date(now))}</span>
              </div>
              <button
                type='button'
                className={`control ${touring ? 'active' : ''}`}
                onClick={() => {
                  setTouring(!touring)
                  if (!touring) {
                    setDomain('all')
                    setFeaturedOnly(true)
                    setSelected({ type: 'app', id: featured[0]?.id || '' })
                  }
                }}
              >
                <i />
                {t(
                  touring ? 'Pause application tour' : 'Start application tour'
                )}
              </button>
              <button
                type='button'
                className='control'
                onClick={() => {
                  void toggleFullscreen()
                }}
              >
                {t(fullscreen ? 'Exit full screen' : 'Full screen')}
              </button>
              <Link
                className='control'
                to='/dashboard/$section'
                params={{ section: 'overview' }}
              >
                {t('Console')}
              </Link>
            </div>
          </div>
          <LifetimeSummary lifetime={lifetime} />
        </header>
        <section
          className={`overview ${current ? 'is-live' : ''}`}
          aria-label={t('Live service overview')}
        >
          <div className='overview-heading'>
            <span>
              <i className={current ? 'live-dot' : 'quiet-dot'} />
              {t('Intelligence at work, right now')}
              <small>
                {t('Current gateway and monitored inference services')}
              </small>
            </span>
            <span>
              {current
                ? t('Sampled {{time}} · updates every 5 seconds', {
                    time: clock.format(new Date(current.asOf)),
                  })
                : t('Last successful sample {{time}} · retrying', {
                    time: lastCurrent
                      ? clock.format(new Date(lastCurrent.asOf))
                      : '—',
                  })}
              <button type='button' onClick={() => setShowSources(true)}>
                {t('Data scope')} ↗
              </button>
            </span>
          </div>
          <div className='overview-metrics'>
            <Metric
              label='Current service requests'
              value={current?.inFlight ?? lastCurrent?.inFlight}
              note={t('{{count}} responses started', {
                count: (current || lastCurrent)?.generating ?? '—',
              })}
              tone='mint'
            />
            <Metric
              label='Applications in service'
              value={current?.recognizedApps ?? lastCurrent?.recognizedApps}
              note={t('Attributed applications with in-flight calls')}
            />
            <Metric
              label='Models in use'
              value={current?.activeModels ?? lastCurrent?.activeModels}
              note={t('Models handling in-flight requests')}
            />
            <Metric
              label='In-flight input context'
              value={current?.promptTokens ?? lastCurrent?.promptTokens}
              unit='Tokens'
              note={t('Input carried by current requests')}
              tone='gold'
            />
            <Metric
              label='Input processing speed'
              value={input}
              unit='/s'
              note={t('Valid sources {{valid}}/{{total}}', {
                valid: inputSources.length,
                total: current?.engines.length || 0,
              })}
            />
            <Metric
              label='Model output speed'
              value={output}
              unit='/s'
              note={t('Valid sources {{valid}}/{{total}}', {
                valid: outputSources.length,
                total: current?.engines.length || 0,
              })}
              tone='mint'
            />
            <Metric
              label='Prefix cache reuse'
              value={reuse}
              ratio
              note={t('Weighted by valid input processing')}
            />
            <Metric
              label='Inference parallelism'
              value={parallel}
              note={t('Concurrent work across monitored engines')}
            />
          </div>
        </section>
        <div className='main-grid'>
          <section className='panel business-panel'>
            <Heading
              number='01'
              title='Business applications in action'
              english='BUSINESS IN ACTION'
            />
            <div className='business-toolbar'>
              <span>{t('Organized by business domain')}</span>
              <span>
                {t('{{apps}} applications · {{domains}} domains', {
                  apps: data.applications.length,
                  domains: data.scenes.length,
                })}
              </span>
            </div>
            <div className='filter-chips' aria-label={t('Business domains')}>
              <button
                type='button'
                aria-pressed={domain === 'all'}
                onClick={() => chooseDomain('all')}
              >
                {t('All')}
              </button>
              {sceneDefinitions.map((scene) => (
                <button
                  type='button'
                  key={scene.id}
                  aria-pressed={domain === scene.id}
                  onClick={() => chooseDomain(scene.id)}
                >
                  {t(scene.name)}
                </button>
              ))}
            </div>
            <div className='business-list-mode'>
              <span>
                {period} · {t('Recorded usage')}
              </span>
              <div className='small-tabs'>
                <button
                  type='button'
                  aria-pressed={featuredOnly}
                  onClick={() => {
                    setFeaturedOnly(true)
                    setTouring(false)
                    setPage(0)
                  }}
                >
                  {t('Featured')}
                </button>
                <button
                  type='button'
                  aria-pressed={!featuredOnly}
                  onClick={() => {
                    setFeaturedOnly(false)
                    setTouring(false)
                    setPage(0)
                  }}
                >
                  {t('All')}
                </button>
              </div>
            </div>
            <div className='application-list'>
              {visibleApps.map((item) => {
                const live = liveApps.get(item.id)
                return (
                  <button
                    type='button'
                    key={item.id}
                    className={`application-card ${app?.id === item.id ? 'selected' : ''}`}
                    aria-pressed={app?.id === item.id}
                    onClick={() => chooseApp(item)}
                  >
                    <span className='app-card-top'>
                      <strong>
                        {item.name}
                        <i className={live ? 'live-dot' : 'quiet-dot'} />
                      </strong>
                      <small>
                        {t(
                          sceneDefinitions.find(
                            (scene) => scene.id === item.scene
                          )?.name || ''
                        )}
                      </small>
                    </span>
                    <span className='app-purpose'>{t(item.headline)}</span>
                    <span className='app-live-facts'>
                      <span>
                        {t('In flight')}{' '}
                        <b>{current ? live?.inFlight || 0 : '—'}</b>
                      </span>
                      <span>
                        {t('Context')}{' '}
                        <Amount
                          value={current ? (live?.promptTokens ?? 0) : null}
                        />
                      </span>
                      <span>
                        {t('Responding')}{' '}
                        <b>
                          {current
                            ? (live?.inFlight || 0) - (live?.prefilling || 0)
                            : '—'}
                        </b>
                      </span>
                    </span>
                    <span className='app-history'>
                      <span>
                        <Amount value={item.requests} kind='requests' />
                        {t('Recorded calls')}
                      </span>
                      <span>
                        {t('{{models}} models · {{days}} active days', {
                          models: item.models.length,
                          days: item.activeDays,
                        })}
                      </span>
                    </span>
                  </button>
                )
              })}
              {!visibleApps.length && (
                <p className='empty-state'>
                  {t(
                    snapshotQuery.isFetching
                      ? 'Reading application usage'
                      : 'No applications in this domain and period'
                  )}
                </p>
              )}
            </div>
            <div className='list-footer'>
              <span>
                {t('{{count}} attributed applications', {
                  count: candidates.length,
                })}
              </span>
              <div className='pagination'>
                <button
                  type='button'
                  aria-label={t('Previous applications')}
                  disabled={activePage === 0}
                  onClick={() => {
                    setTouring(false)
                    setPage(activePage - 1)
                  }}
                >
                  ←
                </button>
                <span>
                  {activePage + 1} / {pages}
                </span>
                <button
                  type='button'
                  aria-label={t('Next applications')}
                  disabled={activePage >= pages - 1}
                  onClick={() => {
                    setTouring(false)
                    setPage(activePage + 1)
                  }}
                >
                  →
                </button>
              </div>
            </div>
          </section>
          <section className='panel case-panel'>
            <Heading
              number='02'
              title='Gentis model families'
              english='CONNECTED CAPABILITIES'
            >
              <span className='case-state'>
                <i className={stageLive ? 'live-dot' : 'quiet-dot'} />
                {t(
                  stageLive
                    ? '{{count}} requests in service'
                    : 'Recorded application evidence',
                  { count: stageLive?.inFlight || 0 }
                )}
              </span>
            </Heading>
            <div className='case-hero'>
              <div className='case-category'>
                <span>
                  {t(
                    selectedModel?.type ||
                      sceneDefinitions.find((scene) => scene.id === app?.scene)
                        ?.name ||
                      'Business application'
                  )}
                </span>
                <span>
                  {t(
                    selectedModel
                      ? '{{count}} connected applications'
                      : 'Unified model services',
                    { count: selectedModel?.applicationIds.length }
                  )}
                </span>
              </div>
              <h3 data-testid='case-title'>
                {selectedModel?.id ||
                  app?.name ||
                  t('Business application services')}
              </h3>
              <h4>
                {t(
                  selectedModel
                    ? 'Model capabilities connected to real applications'
                    : app?.headline ||
                        'From model capabilities to business practice'
                )}
              </h4>
              <p>
                {t(
                  selectedModel
                    ? 'Explore recorded application relationships and current model observations.'
                    : app?.description ||
                        'Waiting for attributed application records.'
                )}
              </p>
            </div>
            <div className='case-facts'>
              <div>
                <span>{t('Current service requests')}</span>
                <Amount value={current ? stageLive?.inFlight || 0 : null} />
              </div>
              <div>
                <span>{t('Current input context')}</span>
                <Amount
                  value={current ? (stageLive?.promptTokens ?? 0) : null}
                />
              </div>
              <div>
                <span>
                  {period} · {t('Service calls')}
                </span>
                <Amount
                  value={selectedModel?.requests ?? app?.requests}
                  kind='requests'
                />
              </div>
              <div>
                <span>{period} · Tokens</span>
                <Amount value={selectedModel?.tokens ?? app?.tokens} />
              </div>
            </div>
            <ServiceNetwork
              applications={gentisApplications}
              modelIds={modelIds}
              selected={
                selectedModel
                  ? { type: 'model', id: selectedModel.id }
                  : { type: 'app', id: app?.id || '' }
              }
              current={current ? { ...current, models: gentisLive } : null}
              period={period}
              onApplication={chooseApp}
              onModel={chooseModel}
            />
            <div className='model-observations'>
              <div className='model-observation-heading'>
                <span>{t('Thinking and standard variants combined')}</span>
                <div className='pagination'>
                  <button
                    type='button'
                    aria-label={t('Previous models')}
                    disabled={modelPage === 0}
                    onClick={() => setModelPage(modelPage - 1)}
                  >
                    ←
                  </button>
                  <span>
                    {Math.min(modelPage + 1, modelPages)} / {modelPages}
                  </span>
                  <button
                    type='button'
                    aria-label={t('Next models')}
                    disabled={modelPage >= modelPages - 1}
                    onClick={() => setModelPage(modelPage + 1)}
                  >
                    →
                  </button>
                </div>
              </div>
              <div className='model-table-head'>
                <span>{t('Model service')}</span>
                <span>{t('In flight')}</span>
                <span>{t('Context')}</span>
                <span>{t('First token observed')}</span>
              </div>
              {visibleModels.map((item) => {
                const live = liveModels.get(item.id)
                return (
                  <button
                    type='button'
                    className='model-observation-row'
                    key={item.id}
                    onClick={() => chooseModel(item.id)}
                  >
                    <strong>
                      <i className={live ? 'live-dot' : 'quiet-dot'} />
                      {item.id}
                    </strong>
                    <span>{current ? live?.inFlight || 0 : '—'}</span>
                    <span>
                      <Amount
                        value={current ? (live?.promptTokens ?? 0) : null}
                      />
                    </span>
                    <span>
                      {live?.observedTTFTMs != null
                        ? `${(live.observedTTFTMs / 1000).toFixed(2)}s`
                        : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className='case-bottomline'>
              <span>
                <i />
                {t('Xiamen · multiple machines · unified model services')}
              </span>
              <span>
                {t(
                  'Gentis families in the flow; all models in platform totals.'
                )}
              </span>
            </div>
          </section>
          <ProfessionalPanel current={current} now={now} />
        </div>
        <div className='bottom-grid'>
          <section className='panel realtime-trend-panel'>
            <Heading
              number='04'
              title='Live service rhythm'
              english='LIVE SERVICE PULSE'
            />
            <LiveTrend samples={samples} now={now} />
          </section>
          <section className='panel coverage-panel'>
            <Heading
              number='05'
              title='Business domain coverage'
              english='BUSINESS REACH'
            />
            <div className='coverage-toolbar'>
              <span>
                {period} · {t('Attributed business usage')}
              </span>
              <div className='small-tabs'>
                <button
                  type='button'
                  aria-pressed={coverageMetric === 'applications'}
                  onClick={() => setCoverageMetric('applications')}
                >
                  {t('Applications')}
                </button>
                <button
                  type='button'
                  aria-pressed={coverageMetric === 'tokens'}
                  onClick={() => setCoverageMetric('tokens')}
                >
                  {t('Tokens')}
                </button>
              </div>
            </div>
            <div className='coverage-list'>
              {coverage.map((scene) => (
                <div className='coverage-row' key={scene.id}>
                  <span>
                    <i style={{ background: scene.color }} />
                    {t(scene.name)}
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${(scene[coverageMetric] / Math.max(coverage[0]?.[coverageMetric] || 0, 1)) * 100}%`,
                        background: scene.color,
                      }}
                    />
                  </div>
                  <strong>
                    {coverageMetric === 'applications'
                      ? scene.applications
                      : `${((scene.tokens / Math.max(coverageTotal, 1)) * 100).toFixed(1)}%`}
                  </strong>
                </div>
              ))}
            </div>
            <div className='coverage-caption'>
              {t(
                'Same applications are combined across departments. Domains describe business purpose.'
              )}
            </div>
          </section>
          <section className='panel history-panel'>
            <Heading
              number='06'
              title='Sustained application adoption'
              english='PROVEN ADOPTION'
            >
              <div className='range-switch'>
                {[1, 7, 30].map((value) => (
                  <button
                    type='button'
                    key={value}
                    aria-pressed={range === value}
                    onClick={() => {
                      setRange(value)
                      setPage(0)
                      setModelPage(0)
                    }}
                  >
                    {value === 1
                      ? t('Today')
                      : t('{{count}} days', { count: value })}
                  </button>
                ))}
              </div>
            </Heading>
            <div className='history-totals'>
              <div>
                <Amount value={snapshot ? data.tokens : null} />
                <small>{t('Tokens processed')}</small>
              </div>
              <div>
                <Amount
                  value={snapshot ? data.requests : null}
                  kind='requests'
                />
                <small>{t('Service calls')}</small>
              </div>
              <div>
                <strong>
                  {snapshot ? data.applications.length : '—'}
                  <small> / {data.scenes.length}</small>
                </strong>
                <small>{t('Applications / domains')}</small>
              </div>
            </div>
            <div className='history-toolbar'>
              <div className='small-tabs'>
                <button
                  type='button'
                  aria-pressed={historyScope === 'platform'}
                  onClick={() => setHistoryScope('platform')}
                >
                  {t('Platform')}
                </button>
                <button
                  type='button'
                  aria-pressed={historyScope === 'case'}
                  onClick={() => setHistoryScope('case')}
                >
                  {t(selectedModel ? 'Selected model' : 'Selected application')}
                </button>
              </div>
              <div className='small-tabs'>
                <button
                  type='button'
                  aria-pressed={historyMetric === 'tokens'}
                  onClick={() => setHistoryMetric('tokens')}
                >
                  {t('Tokens')}
                </button>
                <button
                  type='button'
                  aria-pressed={historyMetric === 'requests'}
                  onClick={() => setHistoryMetric('requests')}
                >
                  {t('Calls')}
                </button>
              </div>
            </div>
            <UsageTrend days={historyDays} metric={historyMetric} />
          </section>
        </div>
        <footer className='footer'>
          <span>
            new-api · QuantumNous ·{' '}
            {t('Applications × model delivery × professional inference')}
          </span>
          <div>
            <span>
              {snapshot
                ? t('Usage snapshot {{time}} · updates every 5 minutes', {
                    time: clock.format(new Date(snapshot.asOf)),
                  })
                : t('Waiting for the usage snapshot')}
              {snapshotQuery.isError &&
                ` · ${t('Keeping the last successful snapshot')}`}
            </span>
            <button
              type='button'
              onClick={refresh}
              disabled={snapshotQuery.isFetching || liveQuery.isFetching}
            >
              {t('Refresh data')}
            </button>
            <button type='button' onClick={() => setShowSources(true)}>
              {t('Data scope')}
            </button>
          </div>
        </footer>
        {notice && (
          <div className='notice' role='status'>
            {notice}
            <button type='button' onClick={() => setNotice('')}>
              {t('Close')}
            </button>
          </div>
        )}
        <dialog
          className='source-dialog'
          ref={dialogRef}
          onCancel={() => setShowSources(false)}
          onClose={() => setShowSources(false)}
        >
          <div className='dialog-heading'>
            <span>DATA & SCOPE</span>
            <button
              type='button'
              aria-label={t('Close data scope')}
              onClick={() => setShowSources(false)}
            >
              {t('Close')} ×
            </button>
          </div>
          <h2>{t('Real services. Visible business value.')}</h2>
          <dl>
            <div>
              <dt>{t('Real-time services')}</dt>
              <dd>
                {t(
                  'Current requests, input context, applications and models come from complete in-memory gateway aggregates. They update every 5 seconds. Application names are combined across departments; people, keys and addresses are excluded.'
                )}
              </dd>
            </div>
            <div>
              <dt>{t('Application relationships')}</dt>
              <dd>
                {t(
                  'Lines show recorded application-model calls in the selected period. Dots show current in-flight activity. Platform model and engine performance is not attributed to a specific application.'
                )}{' '}
                {t(
                  'Gentis network: thinking variants are combined with their standard counterparts; application and platform totals still include every model.'
                )}
              </dd>
            </div>
            <div>
              <dt>{t('Professional inference')}</dt>
              <dd>
                {t(
                  'Fresh engine samples are deduplicated by endpoint. Input and output sum valid sources; cache reuse is weighted by valid input. Unavailable measurements remain unknown. Endpoints do not represent physical machine counts.'
                )}
              </dd>
            </div>
            <div>
              <dt>{t('Historical usage')}</dt>
              <dd>
                {t(
                  'All-time totals cover all recorded models and are independent of the period filters.'
                )}{' '}
                {t(
                  'Usage is aggregated hourly and refreshed every 5 minutes, using Beijing calendar days. Platform totals include unattributed usage; application and domain coverage exclude it. Application descriptions are editorial categories, not measured productivity claims.'
                )}{' '}
                {data.firstDay} — {data.lastDay}
              </dd>
            </div>
            <div>
              <dt>{t('Continuous updates and access')}</dt>
              <dd>
                {t(
                  'This page uses the project login and automatic access-token refresh. Temporary network failures retain the last successful data with its timestamp. Expired or revoked login sessions require signing in again; no permanent administrator credential is created.'
                )}
              </dd>
            </div>
          </dl>
          <button
            type='button'
            className='dialog-close'
            onClick={() => setShowSources(false)}
          >
            {t('Return to showcase')}
          </button>
        </dialog>
      </main>
    </div>
  )
}
