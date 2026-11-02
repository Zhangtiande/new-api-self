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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'

import { formatAmount } from './data'
import type { ShowcaseCurrent } from './types'

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

function Reading(props: {
  value?: number | null
  unit?: string
  kind?: 'duration' | 'ratio'
}) {
  const { t } = useTranslation()
  const value = props.value
  const known =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER &&
    (props.kind !== 'ratio' || value <= 1)
  if (!known) {
    return (
      <span className='prof-reading prof-unknown'>
        <strong>—</strong>
        <small>{props.unit}</small>
      </span>
    )
  }
  if (props.kind === 'ratio') {
    return (
      <span className='prof-reading'>
        <strong>{decimal.format(value * 100)}</strong>
        <small>%</small>
      </span>
    )
  }
  if (props.kind === 'duration') {
    return (
      <span className='prof-reading'>
        <strong>{decimal.format(value >= 1000 ? value / 1000 : value)}</strong>
        <small>{value >= 1000 ? 's' : 'ms'}</small>
      </span>
    )
  }
  const amount = formatAmount(value)
  return (
    <span className='prof-reading'>
      <strong>{amount.value}</strong>
      <small>
        {t(amount.unit)}
        {props.unit ? ` ${t(props.unit)}` : ''}
      </small>
    </span>
  )
}

export function ProfessionalPanel(props: {
  current: ShowcaseCurrent | null
  now: number
}) {
  const { t, i18n } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const clock = new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const engines = (props.current?.engines || []).filter(
    (engine) =>
      props.now >= Date.parse(engine.asOf) - 5000 &&
      props.now < Date.parse(engine.validUntil)
  )
  const selectedIndex = Math.max(
    0,
    engines.findIndex((engine) => engine.id === selectedId)
  )
  const engine = engines[selectedIndex]
  const fields = [
    'inputTokensPerSecond',
    'outputTokensPerSecond',
    'runningRequests',
  ] as const
  const totals = fields.map((field) => {
    const values = engines
      .map((item) => item[field])
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0
      )
    const valid =
      field === 'runningRequests'
        ? values.length === engines.length
        : values.length > 0
    return {
      value:
        engines.length && valid
          ? values.reduce((sum, value) => sum + value, 0)
          : null,
      samples: values.length,
    }
  })
  const pool = [
    engine?.activeTokens,
    engine?.cachedTokens,
    engine?.freeTokens,
    engine?.capacityTokens,
  ]
  const poolKnown = pool.every(
    (value) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  )
  const consistent = Boolean(
    engine &&
    poolKnown &&
    engine.capacityTokens &&
    (engine.activeTokens ?? 0) +
      (engine.cachedTokens ?? 0) +
      (engine.freeTokens ?? 0) ===
      engine.capacityTokens
  )
  const segments = [
    { field: 'activeTokens', label: 'Active context', color: 'active' },
    { field: 'cachedTokens', label: 'Reusable cache', color: 'cached' },
    { field: 'freeTokens', label: 'Available context', color: 'free' },
  ] as const
  return (
    <section
      className='panel professional-panel'
      aria-labelledby='professional-heading'
    >
      <header className='prof-heading'>
        <div>
          <span className='prof-section-index'>03</span>
          <h2 id='professional-heading'>{t('Professional inference')}</h2>
        </div>
        <span className='prof-heading-english'>INFERENCE</span>
      </header>
      <div
        className={`prof-source ${engines.length ? 'prof-source-fresh' : ''}`}
      >
        <span>
          <i />
          {t(
            engines.length
              ? 'Fresh monitored services'
              : 'Waiting for a fresh sample'
          )}
        </span>
        <span className='prof-source-count'>
          {t('{{count}} services', { count: engines.length })}
          <span>
            {t('Parallel execution')} <Reading value={totals[2].value} />
          </span>
        </span>
      </div>
      <div className='prof-overview'>
        {[0, 1].map((index) => (
          <div key={index}>
            <span className='prof-label'>
              {t(index === 0 ? 'Live input' : 'Live output')}
              <small>
                {t('Valid sources {{valid}}/{{total}}', {
                  valid: totals[index].samples,
                  total: engines.length,
                })}
              </small>
            </span>
            <Reading value={totals[index].value} unit='Tokens/s' />
          </div>
        ))}
      </div>
      <div className='prof-service-nav'>
        <span className='prof-service-name'>
          {engine
            ? t('Inference service {{number}}', {
                number: engine.name.match(/\d+$/)?.[0] || selectedIndex + 1,
              })
            : t('Inference sampling')}
        </span>
        <div>
          <button
            type='button'
            aria-label={t('Previous inference service')}
            disabled={!engine || selectedIndex === 0}
            onClick={() => setSelectedId(engines[selectedIndex - 1].id)}
          >
            ←
          </button>
          <span>
            {engines.length
              ? `${selectedIndex + 1} / ${engines.length}`
              : '— / —'}
          </span>
          <button
            type='button'
            aria-label={t('Next inference service')}
            disabled={!engine || selectedIndex >= engines.length - 1}
            onClick={() => setSelectedId(engines[selectedIndex + 1].id)}
          >
            →
          </button>
        </div>
      </div>
      <div className='prof-service-body'>
        <div className='prof-service-meta'>
          <span>
            {engine
              ? clock.format(new Date(engine.asOf))
              : t('No fresh service sample')}
          </span>
          <span>
            {t('Parallel execution')}{' '}
            <Reading value={engine?.runningRequests} />
          </span>
        </div>
        <div className='prof-service-rates'>
          <span>
            {t('Input')}{' '}
            <Reading value={engine?.inputTokensPerSecond} unit='Tokens/s' />
          </span>
          <span>
            {t('Output')}{' '}
            <Reading value={engine?.outputTokensPerSecond} unit='Tokens/s' />
          </span>
        </div>
        <div className='prof-latencies'>
          {[
            { label: 'First token', value: engine?.ttftMs },
            { label: 'Token interval', value: engine?.interTokenMs },
            { label: 'End-to-end time', value: engine?.e2eLatencyMs },
          ].map((item) => (
            <div key={item.label}>
              <span className='prof-label'>{t(item.label)}</span>
              <Reading value={item.value} kind='duration' unit='ms' />
            </div>
          ))}
        </div>
        <div className='prof-cache'>
          <div>
            <span className='prof-label'>{t('Input cache reuse')}</span>
            <Reading value={engine?.cacheReuseRatio} kind='ratio' unit='%' />
          </div>
          <p>
            {t('Reuse existing context')}
            <br />
            <span>{t('Reduce repeated computation')}</span>
          </p>
          <div className='prof-reuse-track' aria-hidden='true'>
            {engine?.cacheReuseRatio != null && (
              <i style={{ width: `${engine.cacheReuseRatio * 100}%` }} />
            )}
          </div>
        </div>
        <div className='prof-context'>
          <div className='prof-context-heading'>
            <h3>{t('Context composition')}</h3>
            <span>
              {t('Capacity')}{' '}
              <Reading value={engine?.capacityTokens} unit='Tokens' />
            </span>
          </div>
          {consistent && engine ? (
            <div
              className='prof-context-bar'
              role='img'
              aria-label={t(
                'Active context, reusable cache and available capacity'
              )}
            >
              {segments.map((segment) => (
                <span
                  key={segment.field}
                  className={`prof-context-${segment.color}`}
                  style={{
                    width: `${((engine[segment.field] ?? 0) / (engine.capacityTokens || 1)) * 100}%`,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className='prof-context-caption'>
              {t('Waiting for context composition')}
            </div>
          )}
          <div className='prof-context-legend'>
            {segments.map((segment) => (
              <div key={segment.field}>
                <span>
                  <i className={`prof-context-${segment.color}`} />
                  {t(segment.label)}
                </span>
                <Reading value={engine?.[segment.field]} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className='prof-footnote'>
        <span>{t('Monitored services, not application-specific')}</span>
        <span>{t('Service endpoints are not machine counts')}</span>
      </footer>
    </section>
  )
}
