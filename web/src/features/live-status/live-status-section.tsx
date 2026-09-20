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

// A long-context deployment only clears its prefill demand because the prefix
// cache absorbs most of it. Below this the engine has to compute a share it was
// never sized for, and latency compounds from there.
const CACHE_HIT_CRITICAL = 0.8

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(ms, 0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m${seconds}s`
}

// Token counts on this panel run from a few hundred to several million, so the
// raw integers stop being comparable at a glance exactly where it matters.
function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
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
        <TableCell colSpan={11} className='text-muted-foreground text-xs'>
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
        <TableCell colSpan={11}>
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
        {engine.retracted_reqs > 0 ? (
          <Badge variant='destructive' className='ml-2'>
            {t('Preempting')}
          </Badge>
        ) : null}
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
        className={cn(
          'font-medium tabular-nums',
          usageTone(engine.token_usage)
        )}
      >
        {formatTokens(engine.kv_active_tokens || engine.used_tokens)}
        {engine.max_total_tokens > 0 ? (
          <span className='text-muted-foreground'>
            {' / '}
            {formatTokens(engine.max_total_tokens)}
          </span>
        ) : null}
      </TableCell>
      <TableCell className='tabular-nums'>
        {engine.max_total_tokens > 0
          ? `${((engine.kv_cached_tokens / engine.max_total_tokens) * 100).toFixed(0)}%`
          : '-'}
      </TableCell>
      <TableCell
        className={cn(
          'font-medium tabular-nums',
          engine.prompt_tokens_rate > 0 &&
            engine.cache_hit_token_rate < CACHE_HIT_CRITICAL &&
            'text-red-600 dark:text-red-400'
        )}
      >
        {engine.prompt_tokens_rate > 0
          ? `${(engine.cache_hit_token_rate * 100).toFixed(1)}%`
          : `${(engine.cache_hit_rate * 100).toFixed(0)}%`}
      </TableCell>
      <TableCell className='tabular-nums'>
        {engine.prefill_compute_rate > 0
          ? formatTokens(engine.prefill_compute_rate)
          : '-'}
      </TableCell>
      <TableCell
        className={cn(
          'tabular-nums',
          engine.eviction_rate > engine.prompt_tokens_rate &&
            engine.eviction_rate > 0 &&
            'text-red-600 dark:text-red-400'
        )}
      >
        {engine.eviction_rate > 0 ? formatTokens(engine.eviction_rate) : '-'}
      </TableCell>
      <TableCell className='tabular-nums'>
        {engine.output_tokens_rate > 0
          ? engine.output_tokens_rate.toFixed(0)
          : engine.gen_throughput.toFixed(0)}
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
        {engine.queue_time_ms > 0
          ? `${engine.queue_time_ms.toFixed(0)}ms`
          : '-'}
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
    data?.channels.reduce((sum, c) => sum + (c.engine?.queued_reqs ?? 0), 0) ??
    0
  const staleChannels =
    data?.channels.filter((c) => c.has_engine && !c.engine?.fresh).length ?? 0
  const liveEngines = data?.channels.filter((c) => c.engine?.fresh) ?? []
  const promptRate = liveEngines.reduce(
    (sum, c) => sum + (c.engine?.prompt_tokens_rate ?? 0),
    0
  )
  const computeRate = liveEngines.reduce(
    (sum, c) => sum + (c.engine?.prefill_compute_rate ?? 0),
    0
  )
  const cacheHit = promptRate > 0 ? 1 - computeRate / promptRate : 0
  const totalContext = data?.prompt_tokens ?? 0
  // The request list carries channel ids only; the channel list is the single
  // place that knows their names, so resolve here rather than making an
  // operator memorise which number is which upstream.
  const channelNames = new Map(
    data?.channels.map((c) => [c.channel_id, c.channel_name]) ?? []
  )

  if (query.isError) {
    return (
      <Alert variant='destructive'>
        <AlertDescription>{t('Failed to load live status')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-3'>
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
        <SummaryCard
          label={t('Live context')}
          value={formatTokens(data?.prompt_tokens ?? 0)}
          hint={t('Context held open by in-flight requests')}
        />
        <SummaryCard
          label={t('Prefix cache hit')}
          value={promptRate > 0 ? `${(cacheHit * 100).toFixed(1)}%` : '-'}
          hint={t('Share of prefill tokens the engine did not have to compute')}
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
                <TableHead>{t('KV active')}</TableHead>
                <TableHead>{t('Cache resident')}</TableHead>
                <TableHead>{t('Prefix hit')}</TableHead>
                <TableHead>{t('Compute tok/s')}</TableHead>
                <TableHead>{t('Evicted tok/s')}</TableHead>
                <TableHead>{t('Output tok/s')}</TableHead>
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
                    colSpan={13}
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
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'KV active is what running sequences hold; cache resident is the reusable prefix tree, which fills the pool by design. A full pool is normal, a full pool with a high eviction rate is thrashing.'
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
                    <TableCell className='tabular-nums'>
                      {m.in_flight}
                    </TableCell>
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
                      {formatTokens(m.prompt_tokens)}
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
        <h3 className='mb-2 text-sm font-medium'>{t('Compute by key')}</h3>
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('API key')}</TableHead>
                <TableHead>{t('User')}</TableHead>
                <TableHead>{t('Held context')}</TableHead>
                <TableHead>{t('Share')}</TableHead>
                <TableHead>{t('In-flight')}</TableHead>
                <TableHead>{t('Prefilling')}</TableHead>
                <TableHead>{t('Oldest')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.tokens.length ? (
                data.tokens.map((tk) => (
                  <TableRow key={tk.token_id}>
                    <TableCell className='max-w-[16rem] truncate font-medium'>
                      {tk.token_name || `#${tk.token_id}`}
                    </TableCell>
                    <TableCell className='max-w-[10rem] truncate'>
                      {tk.username || '-'}
                    </TableCell>
                    <TableCell className='font-medium tabular-nums'>
                      {formatTokens(tk.prompt_tokens)}
                    </TableCell>
                    <TableCell className='text-muted-foreground tabular-nums'>
                      {totalContext > 0
                        ? `${((tk.prompt_tokens / totalContext) * 100).toFixed(0)}%`
                        : '-'}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {tk.in_flight}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'tabular-nums',
                        tk.prefilling > 0 &&
                          'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {tk.prefilling}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {formatDuration(tk.max_age_ms)}
                    </TableCell>
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
        <p className='text-muted-foreground mt-2 text-xs'>
          {t(
            'Ranked by context held open, not by request count. One long conversation occupies more of the KV cache than dozens of short calls, so this ordering is what maps to GPU cost.'
          )}
        </p>
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
                <TableHead>{t('API key')}</TableHead>
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
                    <TableCell className='max-w-[12rem] truncate'>
                      {channelNames.get(r.channel_id) || `#${r.channel_id}`}
                    </TableCell>
                    <TableCell className='max-w-[14rem] truncate'>
                      {r.token_name || `#${r.token_id}`}
                    </TableCell>
                    <TableCell className='max-w-[10rem] truncate'>
                      {r.username || r.user_id}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {formatTokens(r.prompt_tokens)}
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
                    colSpan={8}
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
