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
import type { ShowcaseSample } from './types'

const modes = [
  {
    id: 'requests',
    label: 'Service rhythm',
    unit: 'requests',
    fields: [
      { key: 'inFlight', label: 'In-flight requests', color: '#79e0c9' },
      { key: 'generating', label: 'Response started', color: '#86b8ee' },
    ],
  },
  {
    id: 'throughput',
    label: 'Input / output',
    unit: 'Tokens/s',
    fields: [
      {
        key: 'inputTokensPerSecond',
        label: 'Input processing',
        color: '#86b8ee',
      },
      { key: 'outputTokensPerSecond', label: 'Model output', color: '#79e0c9' },
    ],
  },
  {
    id: 'context',
    label: 'Context',
    unit: 'Tokens',
    fields: [
      {
        key: 'promptTokens',
        label: 'In-flight input context',
        color: '#d6be91',
      },
    ],
  },
] as const
const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function LiveTrend(props: { samples: ShowcaseSample[]; now: number }) {
  const { t, i18n } = useTranslation()
  const [modeId, setModeId] = useState<string>('requests')
  const mode = modes.find((item) => item.id === modeId) || modes[0]
  const clock = new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const points = [
    ...new Map(
      props.samples.map((sample) => [Date.parse(sample.asOf), sample])
    ),
  ]
    .filter(
      ([at]) =>
        Number.isFinite(at) && at >= props.now - 900000 && at <= props.now
    )
    .sort(([a], [b]) => a - b)
    .map(([at, sample]) => ({ ...sample, at }))
  const observed = points.filter((point) =>
    mode.fields.some((field) => valid(point[field.key]))
  )
  const latest = points.at(-1)
  const last = observed.at(-1)
  const stale = Boolean(last && props.now - last.at > 18000)
  const start = points[0]?.at,
    end = points.at(-1)?.at
  const maximum = Math.max(
    1,
    ...points.flatMap((point) =>
      mode.fields.map((field) =>
        valid(point[field.key]) ? (point[field.key] ?? 0) : 0
      )
    )
  )
  const series = mode.fields.map((field) => {
    let previous: number | undefined,
      path = ''
    const dots: Array<{ x: number; y: number; at: number; value: number }> = []
    for (const point of points) {
      const value = point[field.key]
      if (!valid(value)) {
        previous = undefined
        continue
      }
      const x =
        start === end
          ? 500
          : ((point.at - (start ?? 0)) / ((end ?? 0) - (start ?? 0))) * 1000
      const y = 70 - (value / maximum) * 62
      path += `${previous !== undefined && point.at - previous <= 20000 ? ' L' : ' M'}${x.toFixed(1)},${y.toFixed(1)}`
      dots.push({ x, y, at: point.at, value })
      previous = point.at
    }
    return { ...field, path: path.trim(), dots }
  })
  let status = 'Waiting for a valid sample'
  if (last) {
    status = observed.length === 1 ? 'Building the series' : 'Recorded samples'
  }
  if (stale) status = 'Last sample, not current'
  return (
    <div className={`live-trend${stale ? ' is-stale' : ''}`}>
      <div className='live-trend-toolbar'>
        <div
          className='live-trend-tabs'
          role='group'
          aria-label={t('Live trend metric')}
        >
          {modes.map((item) => (
            <button
              type='button'
              key={item.id}
              aria-pressed={mode.id === item.id}
              onClick={() => setModeId(item.id)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <span className={`live-trend-status ${stale ? 'is-old' : ''}`}>
          {t(status)}
        </span>
      </div>
      <div className='live-trend-readouts'>
        {mode.fields.map((field) => {
          const value = latest?.[field.key]
          const amount = valid(value)
            ? formatAmount(Math.round(value * 10) / 10)
            : null
          return (
            <div
              key={field.key}
              style={{ '--series-color': field.color } as React.CSSProperties}
            >
              <span>
                <i />
                {t(field.label)}
              </span>
              <strong>
                {valid(value) && value > 0 && value < 0.1
                  ? '<0.1'
                  : (amount?.value ?? '—')}
                <small>
                  {amount ? t(amount.unit) : ''}
                  {t(mode.unit)}
                </small>
              </strong>
            </div>
          )
        })}
      </div>
      {observed.length > 0 ? (
        <div className='live-trend-visual'>
          <div className='live-trend-y'>
            <span>
              {formatAmount(Math.ceil(maximum)).value}
              {t(formatAmount(Math.ceil(maximum)).unit)}
            </span>
            <span>0</span>
          </div>
          <div className='live-trend-plot'>
            <svg
              viewBox='0 0 1000 78'
              preserveAspectRatio='none'
              role='img'
              aria-label={t(
                'Recorded live samples; gaps over 20 seconds remain disconnected'
              )}
            >
              <path
                className='live-trend-grid'
                d='M0 8H1000 M0 39H1000 M0 70H1000'
              />
              {series.map((item) => (
                <g
                  key={item.key}
                  style={
                    { '--series-color': item.color } as React.CSSProperties
                  }
                >
                  <path className='live-trend-line' d={item.path} />
                  {item.dots.map((point, index) => (
                    <circle
                      className='live-trend-dot'
                      key={point.at}
                      cx={point.x}
                      cy={point.y}
                      r={
                        item.dots.length === 1 || index === item.dots.length - 1
                          ? 3
                          : 1.7
                      }
                    >
                      <title>
                        {clock.format(new Date(point.at))} · {t(item.label)}{' '}
                        {point.value}
                      </title>
                    </circle>
                  ))}
                </g>
              ))}
            </svg>
            <div className='live-trend-x'>
              <span>{clock.format(new Date(start ?? 0))}</span>
              <span>
                {end !== start
                  ? clock.format(new Date(end ?? 0))
                  : t('Single sample')}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className='live-trend-empty'>
          <span>{t('Waiting for recorded service samples')}</span>
          <small>{t('The chart grows with actual observations')}</small>
        </div>
      )}
      <div className='live-trend-note'>
        <span>{t('Observed samples within the last 15 minutes')}</span>
        <span>
          {last
            ? clock.format(new Date(last.at))
            : t('No invented historical curve')}
        </span>
      </div>
    </div>
  )
}
