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

import { sceneDefinitions } from './data'
import type { ShowcaseApplication, ShowcaseCurrent } from './types'

export type Selection = { type: 'app' | 'model'; id: string }
export function ServiceNetwork(props: {
  applications: ShowcaseApplication[]
  modelIds: string[]
  selected: Selection
  current: ShowcaseCurrent | null
  period: string
  onApplication: (app: ShowcaseApplication) => void
  onModel: (id: string) => void
}) {
  const { t } = useTranslation()
  const apps = props.applications.slice(0, 4),
    models = props.modelIds.slice(0, 4)
  const appLive = new Map(
    props.current?.applications.map((item) => [item.id, item])
  )
  const modelLive = new Map(
    props.current?.models.map((item) => [item.id, item])
  )
  return (
    <div className='service-network'>
      <div className='network-labels'>
        <span>{t('Business applications')}</span>
        <span>{t('Gentis model families')}</span>
      </div>
      <div className='network-canvas'>
        <svg
          viewBox='0 0 680 180'
          preserveAspectRatio='none'
          aria-hidden='true'
        >
          {apps.flatMap((app, index) =>
            app.models
              .filter((model) => models.includes(model.id))
              .map((model) => {
                const modelIndex = models.indexOf(model.id),
                  y1 = ((index + 0.5) / apps.length) * 180,
                  y2 = ((modelIndex + 0.5) / models.length) * 180
                const focused =
                  props.selected.type === 'app'
                    ? props.selected.id === app.id
                    : props.selected.id === model.id
                return (
                  <path
                    key={`${app.id}/${model.id}`}
                    d={`M218 ${y1} C315 ${y1},365 ${y2},462 ${y2}`}
                    className={focused ? 'is-focused' : ''}
                    style={{ strokeWidth: focused ? 2 : 1 }}
                  />
                )
              })
          )}
        </svg>
        {apps.map((app, index) => (
          <button
            type='button'
            key={app.id}
            className={`network-node application-node ${props.selected.type === 'app' && props.selected.id === app.id ? 'is-selected' : ''}`}
            style={{ top: `${((index + 0.5) / apps.length) * 100}%` }}
            onClick={() => props.onApplication(app)}
            aria-pressed={
              props.selected.type === 'app' && props.selected.id === app.id
            }
          >
            <span>
              <i className={appLive.has(app.id) ? 'live-dot' : 'quiet-dot'} />
              <strong>{app.name}</strong>
            </span>
            <small>
              {appLive.has(app.id)
                ? t('{{count}} in flight', {
                    count: appLive.get(app.id)?.inFlight,
                  })
                : t(
                    sceneDefinitions.find((scene) => scene.id === app.scene)
                      ?.name || 'Business application'
                  )}
            </small>
          </button>
        ))}
        {models.map((id, index) => (
          <button
            type='button'
            key={id}
            className={`network-node model-node ${props.selected.type === 'model' && props.selected.id === id ? 'is-selected' : ''}`}
            style={{ top: `${((index + 0.5) / models.length) * 100}%` }}
            onClick={() => props.onModel(id)}
            aria-pressed={
              props.selected.type === 'model' && props.selected.id === id
            }
          >
            <span>
              <strong>{id}</strong>
              <i className={modelLive.has(id) ? 'live-dot' : 'quiet-dot'} />
            </span>
            <small>
              {modelLive.has(id)
                ? t('{{count}} in flight', {
                    count: modelLive.get(id)?.inFlight,
                  })
                : t('Recorded model association')}
            </small>
          </button>
        ))}
        {!apps.length && (
          <p className='empty-state'>
            {t('No attributed application relationships in this period')}
          </p>
        )}
      </div>
      <div className='network-legend'>
        <span>
          <i />
          {t('Lines: recorded calls during {{period}}', {
            period: props.period,
          })}
        </span>
        <span>
          <b />
          {t('Dots: current in-flight activity')}
        </span>
      </div>
    </div>
  )
}
