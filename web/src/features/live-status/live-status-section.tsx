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
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { getLiveStatus, type ChannelLive } from './api'

// Poll rather than stream: the payload is a few KB of pure in-memory state, and
// polling survives reconnects for free.
const POLL_INTERVAL_MS = 2000

// KV cache utilisation past this point means the engine is close to preempting
// running sequences, which is the moment latency falls off a cliff.
const TOKEN_USAGE_CRITICAL = 0.9
const TOKEN_USAGE_WARN = 0.75

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(ms, 0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m${seconds}s`
}

function usageTone(usage: number) {
  if (usage >= TOKEN_USAGE_CRITICAL) return 'text-red-600 dark:text-red-400'
  if (usage >= TOKEN_USAGE_WARN) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function SummaryCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className='rounded-lg border p-4'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='mt-1 text-2xl font-semibold tabular-nums'>
        {props.value}
      </div>
      {props.hint ? (
        <div className='text-muted-foreground mt-1 text-xs'>{props.hint}</div>
      ) : null}
    </div>
  )
}

function ChannelRow(props: { channel: ChannelLive }) {
  const { t } = useTranslation()
  const engine = props.channel.engine

  if (!props.channel.has_engine) {
    return (
      <TableRow>
        <TableCell className='font-medium'>
          #{props.channel.channel_id}
        </TableCell>
        <TableCell className='tabular-nums'>
          {props.channel.gateway_in_flight}
        </TableCell>
        <TableCell
          colSpan={8}
          className='text-muted-foreground text-xs'
        >
          {t('Engine metrics not configured for this channel')}
        </TableCell>
      </TableRow>
    )
  }

  if (!engine?.fresh) {
    return (
      <TableRow>
        <TableCell className='font-medium'>
          {engine?.channel_name || `#${props.channel.channel_id}`}
        </TableCell>
        <TableCell className='tabular-nums'>
          {props.channel.gateway_in_flight}
        </TableCell>
        <TableCell colSpan={8}>
          <Badge variant='destructive'>{t('Scrape failed')}</Badge>
          <span className='text-muted-foreground ml-2 text-xs'>
            {engine?.error}
          </span>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell className='font-medium'>
        {engine.channel_name || `#${props.channel.channel_id}`}
      </TableCell>
      <TableCell className='tabular-nums'>
        {props.channel.gateway_in_flight}
        {props.channel.gateway_prefilling > 0 ? (
          <span className='text-muted-foreground ml-1 text-xs'>
            ({props.channel.gateway_prefilling} {t('prefill')})
          </span>
        ) : null}
      </TableCell>
      <TableCell className='tabular-nums'>{engine.running_reqs}</TableCell>
      <TableCell
        className={cn(
          'tabular-nums',
          engine.queued_reqs > 0 && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {engine.queued_reqs}
      </TableCell>
      <TableCell
        className={cn('font-medium tabular-nums', usageTone(engine.token_usage))}
      >
        {(engine.token_usage * 100).toFixed(0)}%
      </TableCell>
      <TableCell className='tabular-nums'>
        {(engine.cache_hit_rate * 100).toFixed(0)}%
      </TableCell>
      <TableCell className='tabular-nums'>
        {engine.gen_throughput.toFixed(0)}
      </TableCell>
      <TableCell className='tabular-nums'>
        {engine.ttft_ms > 0 ? `${engine.ttft_ms.toFixed(0)}ms` : '-'}
      </TableCell>
      <TableCell
        className={cn(
          'tabular-nums',
          engine.queue_time_ms > 1000 && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {engine.queue_time_ms > 0 ? `${engine.queue_time_ms.toFixed(0)}ms` : '-'}
      </TableCell>
      <TableCell
        className={cn(
          'tabular-nums',
          Math.abs(props.channel.gap) > 2 && 'text-red-600 dark:text-red-400'
        )}
      >
        {props.channel.gap > 0 ? `+${props.channel.gap}` : props.channel.gap}
      </TableCell>
    </TableRow>
  )
}

export function LiveStatusSection() {
  const { t } = useTranslation()

  const query = useQuery({
    queryKey: ['live-status'],
    queryFn: getLiveStatus,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })

  const data = query.data?.data
  const totalPrefilling =
    data?.models.reduce((sum, m) => sum + m.prefilling, 0) ?? 0
  const totalQueued =
    data?.channels.reduce((sum, c) => sum + (c.engine?.queued_reqs ?? 0), 0) ?? 0
  const staleChannels =
    data?.channels.filter((c) => c.has_engine && !c.engine?.fresh).length ?? 0

  if (query.isError) {
    return (
      <Alert variant='destructive'>
        <AlertDescription>{t('Failed to load live status')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <SummaryCard
          label={t('In-flight requests')}
          value={String(data?.total_in_flight ?? 0)}
          hint={t('Relayed by the gateway right now')}
        />
        <SummaryCard
          label={t('Waiting for first token')}
          value={String(totalPrefilling)}
          hint={t('Earliest sign of upstream queueing')}
        />
        <SummaryCard
          label={t('Queued in engine')}
          value={String(totalQueued)}
          hint={t('Reported by sglang')}
        />
        <SummaryCard
          label={t('Unreachable channels')}
          value={String(staleChannels)}
          hint={t('Metrics scrape failing')}
        />
      </div>

      <div>
        <h3 className='mb-2 text-sm font-medium'>{t('GPU pressure')}</h3>
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Channel')}</TableHead>
                <TableHead>{t('Gateway')}</TableHead>
                <TableHead>{t('Running')}</TableHead>
                <TableHead>{t('Queued')}</TableHead>
                <TableHead>{t('KV cache')}</TableHead>
                <TableHead>{t('Prefix hit')}</TableHead>
                <TableHead>{t('Tok/s')}</TableHead>
                <TableHead>{t('TTFT')}</TableHead>
                <TableHead>{t('Queue wait')}</TableHead>
                <TableHead>{t('Gap')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.channels.length ? (
                data.channels.map((channel) => (
                  <ChannelRow key={channel.channel_id} channel={channel} />
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className='text-muted-foreground text-center text-sm'
                  >
                    {t('No active channel')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className='text-muted-foreground mt-2 text-xs'>
          {t(
            'Gap is gateway in-flight minus engine running plus queued. A persistently positive gap points at the network, the gateway or retries rather than at GPU saturation.'
          )}
        </p>
      </div>

      <div>
        <h3 className='mb-2 text-sm font-medium'>{t('By model')}</h3>
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Model')}</TableHead>
                <TableHead>{t('In-flight')}</TableHead>
                <TableHead>{t('Prefilling')}</TableHead>
                <TableHead>{t('Generating')}</TableHead>
                <TableHead>{t('Oldest')}</TableHead>
                <TableHead>{t('Input tokens')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.models.length ? (
                data.models.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className='font-medium'>{m.model}</TableCell>
                    <TableCell className='tabular-nums'>{m.in_flight}</TableCell>
                    <TableCell
                      className={cn(
                        'tabular-nums',
                        m.prefilling > 0 && 'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {m.prefilling}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {m.generating}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {formatDuration(m.max_age_ms)}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {m.prompt_tokens}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='text-muted-foreground text-center text-sm'
                  >
                    {t('Nothing running')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h3 className='mb-2 text-sm font-medium'>
          {t('Longest running requests')}
        </h3>
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Elapsed')}</TableHead>
                <TableHead>{t('Model')}</TableHead>
                <TableHead>{t('Channel')}</TableHead>
                <TableHead>{t('User')}</TableHead>
                <TableHead>{t('Input tokens')}</TableHead>
                <TableHead>{t('TTFT')}</TableHead>
                <TableHead>{t('Retries')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.requests.length ? (
                data.requests.map((r) => (
                  <TableRow key={r.request_id}>
                    <TableCell className='tabular-nums'>
                      {formatDuration(r.age_ms)}
                    </TableCell>
                    <TableCell>{r.model}</TableCell>
                    <TableCell className='tabular-nums'>
                      #{r.channel_id}
                    </TableCell>
                    <TableCell className='tabular-nums'>{r.user_id}</TableCell>
                    <TableCell className='tabular-nums'>
                      {r.prompt_tokens}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {r.ttft_ms >= 0 ? (
                        `${r.ttft_ms}ms`
                      ) : (
                        <Badge variant='secondary'>{t('prefill')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className='tabular-nums'>{r.retries}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='text-muted-foreground text-center text-sm'
                  >
                    {t('Nothing running')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
