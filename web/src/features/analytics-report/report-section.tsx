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
import { VChart } from '@visactor/react-vchart'
import { Loader2, Printer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTheme } from '@/context/theme-provider'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

import { getMonthlyReport } from './api'
import type {
  AnalyticsChannelPerf,
  AnalyticsDimensionStat,
  AnalyticsPeriodReport,
} from './types'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

/** 样本量低于该阈值时，趋势结论标注"仅供参考"。 */
const SAMPLE_THRESHOLD = 30
const TOP_N = 10

function defaultReportMonth(): string {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

function totalTokens(stat: {
  prompt_tokens: number
  completion_tokens: number
}): number {
  return (stat.prompt_tokens || 0) + (stat.completion_tokens || 0)
}

/** 环比变化，prev 为 0 时返回 null（无法计算）。 */
function momPercent(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

function MomBadge({
  cur,
  prev,
  invert = false,
}: {
  cur: number
  prev: number
  /** invert=true 表示数值越低越好（时延类指标） */
  invert?: boolean
}) {
  const { t } = useTranslation()
  const pct = momPercent(cur, prev)
  if (pct === null) {
    return (
      <Badge variant='outline' className='text-muted-foreground'>
        {t('MoM')} —
      </Badge>
    )
  }
  const up = pct > 0
  const good = invert ? !up : up
  const text = `${t('MoM')} ${up ? '+' : ''}${pct.toFixed(1)}%`
  let toneClass = 'text-muted-foreground'
  if (Math.abs(pct) >= 0.05) {
    toneClass = good
      ? 'border-green-600/40 text-green-600 dark:text-green-500'
      : 'border-red-600/40 text-red-600 dark:text-red-500'
  }
  return (
    <Badge variant='outline' className={cn(toneClass)}>
      {text}
    </Badge>
  )
}

function KpiCard({
  label,
  value,
  cur,
  prev,
}: {
  label: string
  value: string
  cur: number
  prev: number
}) {
  return (
    <div className='rounded-lg border px-4 py-3'>
      <div className='text-muted-foreground text-xs'>{label}</div>
      <div className='mt-1 text-xl font-semibold tabular-nums'>{value}</div>
      <div className='mt-1'>
        <MomBadge cur={cur} prev={prev} />
      </div>
    </div>
  )
}

function dimensionRows(
  current: AnalyticsDimensionStat[] | null | undefined,
  previous: AnalyticsDimensionStat[] | null | undefined
) {
  const prevMap = new Map(
    (previous ?? []).map((item) => [item.name, totalTokens(item)])
  )
  const rows = (current ?? []).slice(0, TOP_N).map((item) => ({
    ...item,
    total: totalTokens(item),
    prevTotal: prevMap.get(item.name) ?? 0,
  }))
  const grandTotal = (current ?? []).reduce(
    (sum, item) => sum + totalTokens(item),
    0
  )
  return { rows, grandTotal }
}

function DimensionTable({
  title,
  nameLabel,
  current,
  previous,
  unattributedLabel,
}: {
  title: string
  nameLabel: string
  current: AnalyticsDimensionStat[] | null | undefined
  previous: AnalyticsDimensionStat[] | null | undefined
  unattributedLabel: string
}) {
  const { t } = useTranslation()
  const { rows, grandTotal } = dimensionRows(current, previous)

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='border-b px-4 py-3 text-sm font-medium'>{title}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{nameLabel}</TableHead>
            <TableHead className='text-right'>{t('Requests')}</TableHead>
            <TableHead className='text-right'>{t('Input Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Output Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Total Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Share')}</TableHead>
            <TableHead className='text-right'>{t('MoM')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={7}
                className='text-muted-foreground text-center'
              >
                {t('No data available')}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => {
            const pct = momPercent(row.total, row.prevTotal)
            return (
              <TableRow key={row.name || '__unattributed__'}>
                <TableCell className='max-w-48 truncate font-medium'>
                  {row.name || unattributedLabel}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatCompactNumber(row.request_count)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatCompactNumber(row.prompt_tokens)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatCompactNumber(row.completion_tokens)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatCompactNumber(row.total)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {grandTotal > 0
                    ? `${((row.total / grandTotal) * 100).toFixed(1)}%`
                    : '—'}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {pct === null
                    ? '—'
                    : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ChartCard({
  title,
  spec,
  themeReady,
  resolvedTheme,
  chartKey,
}: {
  title: string
  spec: Record<string, unknown> | null
  themeReady: boolean
  resolvedTheme: string
  chartKey: string
}) {
  const { t } = useTranslation()
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='border-b px-4 py-3 text-sm font-medium'>{title}</div>
      <div className='h-72 p-2'>
        {themeReady && spec ? (
          <VChart
            key={`${chartKey}-${resolvedTheme}`}
            spec={{
              ...spec,
              theme: resolvedTheme === 'dark' ? 'dark' : 'light',
              background: 'transparent',
            }}
            option={VCHART_OPTION}
          />
        ) : (
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            {t('No data available')}
          </div>
        )}
      </div>
    </div>
  )
}

function latencyTrendSpec(
  channel: AnalyticsChannelPerf,
  metric: 'frt_ms' | 'use_time_s',
  medianLabel: string,
  p95Label: string
): Record<string, unknown> | null {
  const daily = channel.daily ?? []
  if (daily.length === 0) return null
  const values: { day: string; value: number; series: string }[] = []
  for (const day of daily) {
    const stats = metric === 'frt_ms' ? day.frt_ms : day.use_time_s
    if (!stats || stats.count === 0) continue
    const label = String(new Date(day.day_ts * 1000).getDate())
    values.push({ day: label, value: stats.p50, series: medianLabel })
    values.push({ day: label, value: stats.p95, series: p95Label })
  }
  if (values.length === 0) return null
  const formatLatency = (datum: Record<string, unknown>) =>
    formatNumber(Math.round(Number(datum?.value) || 0))
  return {
    type: 'line',
    data: [{ id: `${channel.channel_id}-${metric}`, values }],
    xField: 'day',
    yField: 'value',
    seriesField: 'series',
    legends: { visible: true },
    point: { visible: false },
    background: { fill: 'transparent' },
    axes: [
      { orient: 'bottom', type: 'band' },
      {
        orient: 'left',
        type: 'linear',
        label: {
          formatMethod: (value: number) => formatNumber(value),
        },
      },
    ],
    tooltip: {
      mark: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.series,
            value: formatLatency,
          },
        ],
      },
      dimension: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.series,
            value: formatLatency,
          },
        ],
      },
    },
  }
}

function ChannelPerfBlock({
  channel,
  prevChannel,
  themeReady,
  resolvedTheme,
}: {
  channel: AnalyticsChannelPerf
  prevChannel: AnalyticsChannelPerf | undefined
  themeReady: boolean
  resolvedTheme: string
}) {
  const { t } = useTranslation()
  const lowSample =
    channel.frt_ms.count < SAMPLE_THRESHOLD ||
    channel.use_time_s.count < SAMPLE_THRESHOLD

  const frtSpec = useMemo(
    () => latencyTrendSpec(channel, 'frt_ms', t('Median'), t('P95')),
    [channel, t]
  )
  const useTimeSpec = useMemo(
    () => latencyTrendSpec(channel, 'use_time_s', t('Median'), t('P95')),
    [channel, t]
  )

  const metrics: {
    key: string
    label: string
    cur: number
    prev: number
    unit: string
  }[] = [
    {
      key: 'frt-p50',
      label: t('First Token Latency Median'),
      cur: channel.frt_ms.p50,
      prev: prevChannel?.frt_ms.p50 ?? 0,
      unit: 'ms',
    },
    {
      key: 'frt-p95',
      label: t('First Token Latency P95'),
      cur: channel.frt_ms.p95,
      prev: prevChannel?.frt_ms.p95 ?? 0,
      unit: 'ms',
    },
    {
      key: 'use-p50',
      label: t('Completion Time Median'),
      cur: channel.use_time_s.p50,
      prev: prevChannel?.use_time_s.p50 ?? 0,
      unit: 's',
    },
    {
      key: 'use-p95',
      label: t('Completion Time P95'),
      cur: channel.use_time_s.p95,
      prev: prevChannel?.use_time_s.p95 ?? 0,
      unit: 's',
    },
  ]

  const channelTitle = channel.channel_name
    ? `${channel.channel_name} (#${channel.channel_id})`
    : `#${channel.channel_id}`

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm font-semibold'>
          {t('Channel')} {channelTitle}
        </span>
        <Badge variant='secondary'>
          {t('Requests')} {formatCompactNumber(channel.request_count)}
        </Badge>
        <Badge variant='secondary'>
          {t('Valid Samples')} {formatCompactNumber(channel.frt_ms.count)}
        </Badge>
        {lowSample && (
          <Badge
            variant='outline'
            className='border-amber-600/40 text-amber-600 dark:text-amber-500'
          >
            {t('Insufficient samples, trend for reference only')}
          </Badge>
        )}
      </div>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {metrics.map((metric) => (
          <div key={metric.key} className='rounded-lg border px-4 py-3'>
            <div className='text-muted-foreground text-xs'>{metric.label}</div>
            <div className='mt-1 text-lg font-semibold tabular-nums'>
              {metric.cur > 0
                ? `${formatNumber(Math.round(metric.cur))} ${metric.unit}`
                : '—'}
            </div>
            <div className='mt-1'>
              <MomBadge cur={metric.cur} prev={metric.prev} invert />
            </div>
          </div>
        ))}
      </div>
      <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
        <ChartCard
          title={t('First Token Latency Trend (ms)')}
          spec={frtSpec}
          themeReady={themeReady}
          resolvedTheme={resolvedTheme}
          chartKey={`frt-${channel.channel_id}`}
        />
        <ChartCard
          title={t('Completion Time Trend (s)')}
          spec={useTimeSpec}
          themeReady={themeReady}
          resolvedTheme={resolvedTheme}
          chartKey={`use-${channel.channel_id}`}
        />
      </div>
    </div>
  )
}

function tokenTrendSpec(
  current: AnalyticsPeriodReport,
  previous: AnalyticsPeriodReport,
  thisMonthLabel: string,
  lastMonthLabel: string
): Record<string, unknown> | null {
  const values: { day: number; tokens: number; series: string }[] = []
  for (const day of current.daily ?? []) {
    values.push({
      day: new Date(day.day_ts * 1000).getDate(),
      tokens: totalTokens(day),
      series: thisMonthLabel,
    })
  }
  for (const day of previous.daily ?? []) {
    values.push({
      day: new Date(day.day_ts * 1000).getDate(),
      tokens: totalTokens(day),
      series: lastMonthLabel,
    })
  }
  if (values.length === 0) return null
  const formatTokens = (datum: Record<string, unknown>) =>
    formatCompactNumber(Number(datum?.tokens) || 0)
  return {
    type: 'line',
    data: [{ id: 'tokenTrend', values }],
    xField: 'day',
    yField: 'tokens',
    seriesField: 'series',
    legends: { visible: true },
    point: { visible: false },
    background: { fill: 'transparent' },
    axes: [
      { orient: 'bottom', type: 'band' },
      {
        orient: 'left',
        type: 'linear',
        label: {
          formatMethod: (value: number) => formatCompactNumber(value),
        },
      },
    ],
    tooltip: {
      mark: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.series,
            value: formatTokens,
          },
        ],
      },
      dimension: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.series,
            value: formatTokens,
          },
        ],
      },
    },
  }
}

function topBarSpec(
  stats: AnalyticsDimensionStat[] | null | undefined,
  unattributedLabel: string
): Record<string, unknown> | null {
  const rows = (stats ?? []).slice(0, TOP_N)
  if (rows.length === 0) return null
  const values = rows
    .map((row) => ({
      name: row.name || unattributedLabel,
      tokens: totalTokens(row),
    }))
    .reverse()
  const formatTokens = (datum: Record<string, unknown>) =>
    formatCompactNumber(Number(datum?.tokens) || 0)
  return {
    type: 'bar',
    data: [{ id: 'topBar', values }],
    direction: 'horizontal',
    xField: 'tokens',
    yField: 'name',
    seriesField: 'name',
    legends: { visible: false },
    background: { fill: 'transparent' },
    label: {
      visible: true,
      position: 'outside',
      formatMethod: (value: number) => formatCompactNumber(value),
      style: { fontSize: 11 },
    },
    axes: [
      { orient: 'left', type: 'band' },
      {
        orient: 'bottom',
        type: 'linear',
        label: {
          formatMethod: (value: number) => formatCompactNumber(value),
        },
      },
    ],
    tooltip: {
      mark: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.name,
            value: formatTokens,
          },
        ],
      },
      dimension: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.name,
            value: formatTokens,
          },
        ],
      },
    },
  }
}

export function MonthlyReportSection() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)

  const [month, setMonth] = useState(defaultReportMonth)
  const [channelsInput, setChannelsInput] = useState('')
  const [appliedChannels, setAppliedChannels] = useState('')

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    void updateTheme()
  }, [resolvedTheme])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'monthly-report', month, appliedChannels],
    queryFn: () => getMonthlyReport(month, appliedChannels),
    staleTime: 60_000,
  })

  const report = data?.success ? data.data : undefined
  const current = report?.current
  const previous = report?.previous

  const trendSpec = useMemo(
    () =>
      current && previous
        ? tokenTrendSpec(current, previous, t('This month'), t('Last month'))
        : null,
    [current, previous, t]
  )
  const modelBarSpec = useMemo(
    () => (current ? topBarSpec(current.models, t('Unattributed')) : null),
    [current, t]
  )
  const appBarSpec = useMemo(
    () => (current ? topBarSpec(current.apps, t('Unattributed')) : null),
    [current, t]
  )

  const prevChannelById = useMemo(() => {
    const map = new Map<number, AnalyticsChannelPerf>()
    for (const channel of previous?.channels ?? []) {
      map.set(channel.channel_id, channel)
    }
    return map
  }, [previous])

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end gap-2 print:hidden'>
        <div className='flex flex-col gap-1'>
          <span className='text-muted-foreground text-xs'>
            {t('Report Month')}
          </span>
          <Input
            type='month'
            value={month}
            max={defaultReportMonth()}
            onChange={(e) => setMonth(e.target.value || defaultReportMonth())}
            className='w-40'
          />
        </div>
        <div className='flex flex-col gap-1'>
          <span className='text-muted-foreground text-xs'>
            {t('Channel IDs')}
          </span>
          <Input
            value={channelsInput}
            onChange={(e) => setChannelsInput(e.target.value)}
            onBlur={() => setAppliedChannels(channelsInput.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setAppliedChannels(channelsInput.trim())
            }}
            placeholder={t('e.g. 4,5 (empty = top channels by requests)')}
            className='w-64'
          />
        </div>
        <Button
          variant='outline'
          onClick={() => window.print()}
          className='ml-auto'
        >
          <Printer className='mr-1 size-4' />
          {t('Print / Export PDF')}
        </Button>
      </div>

      {isLoading && (
        <div className='text-muted-foreground flex items-center gap-2 py-16 text-sm'>
          <Loader2 className='size-4 animate-spin' />
          {t('Loading report...')}
        </div>
      )}
      {isError && (
        <div className='text-destructive py-16 text-sm'>
          {t('Failed to load report')}
        </div>
      )}

      {report && current && previous && (
        <div className='space-y-4'>
          <div className='text-muted-foreground text-sm'>
            {t('Reporting period')}: {report.month} · {t('Compared to')}:{' '}
            {report.prev_month}
          </div>

          <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
            <KpiCard
              label={t('Total Tokens')}
              value={formatCompactNumber(totalTokens(current.overview))}
              cur={totalTokens(current.overview)}
              prev={totalTokens(previous.overview)}
            />
            <KpiCard
              label={t('Input Tokens')}
              value={formatCompactNumber(current.overview.prompt_tokens)}
              cur={current.overview.prompt_tokens}
              prev={previous.overview.prompt_tokens}
            />
            <KpiCard
              label={t('Output Tokens')}
              value={formatCompactNumber(current.overview.completion_tokens)}
              cur={current.overview.completion_tokens}
              prev={previous.overview.completion_tokens}
            />
            <KpiCard
              label={t('Requests')}
              value={formatCompactNumber(current.overview.request_count)}
              cur={current.overview.request_count}
              prev={previous.overview.request_count}
            />
            <KpiCard
              label={t('Billing Consumption')}
              value={formatQuota(current.overview.quota)}
              cur={current.overview.quota}
              prev={previous.overview.quota}
            />
          </div>

          <ChartCard
            title={t('Total Token Trend')}
            spec={trendSpec}
            themeReady={themeReady}
            resolvedTheme={resolvedTheme}
            chartKey='token-trend'
          />

          <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
            <ChartCard
              title={t('Top Models by Tokens')}
              spec={modelBarSpec}
              themeReady={themeReady}
              resolvedTheme={resolvedTheme}
              chartKey='model-bar'
            />
            <ChartCard
              title={t('Top Apps by Tokens')}
              spec={appBarSpec}
              themeReady={themeReady}
              resolvedTheme={resolvedTheme}
              chartKey='app-bar'
            />
          </div>

          <DimensionTable
            title={t('Model Consumption Details')}
            nameLabel={t('Model')}
            current={current.models}
            previous={previous.models}
            unattributedLabel={t('Unattributed')}
          />
          <DimensionTable
            title={t('App Consumption Details')}
            nameLabel={t('App')}
            current={current.apps}
            previous={previous.apps}
            unattributedLabel={t('Unattributed')}
          />

          <div className='space-y-1'>
            <h3 className='text-sm font-semibold'>
              {t('Channel Performance')}
            </h3>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Median as the primary indicator, P95 as the tail indicator; empty, negative and invalid values are excluded.'
              )}
            </p>
          </div>
          {(current.channels ?? []).map((channel) => (
            <ChannelPerfBlock
              key={channel.channel_id}
              channel={channel}
              prevChannel={prevChannelById.get(channel.channel_id)}
              themeReady={themeReady}
              resolvedTheme={resolvedTheme}
            />
          ))}
          {(current.channels ?? []).length === 0 && (
            <div className='text-muted-foreground text-sm'>
              {t('No data available')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
