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
import { useTranslation } from 'react-i18next'

import { Amount } from './primitives'
import type { ShowcaseLifetime } from './types'

export function LifetimeSummary(props: { lifetime?: ShowcaseLifetime }) {
  const { t } = useTranslation()
  const lifetime = props.lifetime
  let period = t('Reading all-time totals')
  if (lifetime) period = t('No recorded history yet')
  if (lifetime?.firstDay && lifetime.lastDay) {
    period = `${lifetime.firstDay.replaceAll('-', '.')} — ${lifetime.lastDay.replaceAll('-', '.')}`
  }
  return (
    <section
      className='lifetime-summary'
      aria-label={t('All-time platform impact')}
    >
      <div className='lifetime-intro'>
        <span className='lifetime-eyebrow'>THE IMPACT SO FAR</span>
        <h2>{t('Intelligence in everyday business')}</h2>
        <p>{t('All models · all recorded history')}</p>
        <span className='lifetime-period'>{period}</span>
      </div>
      <div className='lifetime-primary' data-testid='lifetime-tokens'>
        <span>{t('Cumulative Tokens processed')}</span>
        <Amount value={lifetime?.tokens} />
        <small>Tokens</small>
      </div>
      <div className='lifetime-stats'>
        <div data-testid='lifetime-requests'>
          <span>{t('Total service calls')}</span>
          <Amount value={lifetime?.requests} kind='requests' />
        </div>
        <div>
          <span>{t('Applications reached')}</span>
          <Amount value={lifetime?.applications} />
        </div>
        <div>
          <span>{t('Models served')}</span>
          <Amount value={lifetime?.models} />
        </div>
      </div>
    </section>
  )
}
