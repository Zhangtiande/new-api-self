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
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { formatAmount } from './data'
import type { ShowcaseDay } from './types'

export function Heading(props: {
  number: string
  title: string
  english: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className='section-heading'>
      <div>
        <span className='section-index'>{props.number}</span>
        <h2>{t(props.title)}</h2>
        <span className='section-english'>{props.english}</span>
      </div>
      {props.children}
    </div>
  )
}

export function Amount(props: {
  value?: number | null
  kind?: string
  suffix?: string
}) {
  const { t } = useTranslation()
  const amount =
    props.value == null ? null : formatAmount(props.value, props.kind)
  return (
    <span className='amount'>
      <strong>{amount?.value ?? '—'}</strong>
      <small>
        {amount ? t(amount.unit) : ''}
        {props.suffix}
      </small>
    </span>
  )
}

export function Metric(props: {
  label: string
  value?: number | null
  unit?: string
  ratio?: boolean
  note: string
  tone?: string
}) {
  const { t } = useTranslation()
  let amount = props.value == null ? null : formatAmount(props.value)
  if (props.ratio && props.value != null) {
    amount = { value: (props.value * 100).toFixed(1), unit: '%' }
  }
  return (
    <div className={`overview-metric ${props.tone || ''}`}>
      <span>{t(props.label)}</span>
      <div>
        <strong>
          {!props.ratio &&
          props.value != null &&
          props.value > 0 &&
          props.value < 0.1
            ? '<0.1'
            : (amount?.value ?? '—')}
        </strong>
        <small>
          {amount ? t(amount.unit) : ''}
          {props.unit}
        </small>
      </div>
      <p>{props.note}</p>
    </div>
  )
}

export function UsageTrend(props: {
  days: ShowcaseDay[]
  metric: 'tokens' | 'requests'
}) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const maximum = Math.max(1, ...props.days.map((day) => day[props.metric]))
  const points = props.days.map((day, index) => [
    props.days.length > 1 ? (index / (props.days.length - 1)) * 600 : 300,
    76 - (day[props.metric] / maximum) * 66,
  ])
  const path = points
    .map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`)
    .join(' ')
  const selected = props.days[hover ?? -1] || props.days.at(-1)
  return (
    <div className='usage-trend'>
      <div className='usage-readout'>
        <span>{selected?.day.slice(5) || t('No records')}</span>
        <Amount value={selected?.[props.metric]} kind={props.metric} />
      </div>
      <div className='usage-chart'>
        {props.days.length > 0 ? (
          <>
            <svg
              viewBox='0 0 600 86'
              preserveAspectRatio='none'
              role='img'
              aria-label={t('Daily recorded usage')}
            >
              <path className='chart-grid' d='M0 10H600 M0 43H600 M0 76H600' />
              <path className='usage-line' d={path} />
              {points.length === 1 && (
                <circle
                  cx={points[0][0]}
                  cy={points[0][1]}
                  r='3'
                  fill='#d4bc8f'
                />
              )}
            </svg>
            <div className='usage-targets'>
              {props.days.map((day, index) => (
                <button
                  type='button'
                  key={day.day}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  aria-label={`${day.day}: ${day[props.metric]} ${t(props.metric === 'tokens' ? 'Tokens' : 'Requests')}`}
                />
              ))}
            </div>
          </>
        ) : (
          <p className='empty-state'>
            {t('No usage recorded for this period')}
          </p>
        )}
      </div>
      <div className='usage-axis'>
        <span>{props.days[0]?.day.slice(5)}</span>
        <span>{t('Daily totals')}</span>
        <span>{props.days.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  )
}
