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
import { Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

import { getContentQuestions, getContentTerms } from './api'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const RANGE_DAYS = [7, 30, 90] as const

const PAGE_SIZE = 20

export function ContentInsightSection() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)

  const [rangeDays, setRangeDays] = useState<number>(7)
  const [keywordInput, setKeywordInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [tokenNameInput, setTokenNameInput] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({
    keyword: '',
    username: '',
    tokenName: '',
  })
  const [page, setPage] = useState(1)

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    void updateTheme()
  }, [resolvedTheme])

  // 起止时间随选择的天数区间变化；对齐到本地当天 0 点，避免每次渲染刷新查询键
  const { startTs, endTs } = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    )
    const end = Math.floor(todayStart.getTime() / 1000) + 86400
    return { startTs: end - rangeDays * 86400, endTs: end }
  }, [rangeDays])

  const termsQuery = useQuery({
    queryKey: ['content-insight', 'terms', startTs, endTs],
    queryFn: () => getContentTerms(startTs, endTs),
    staleTime: 60_000,
  })

  const questionsQuery = useQuery({
    queryKey: ['content-insight', 'questions', startTs, endTs, appliedFilters, page],
    queryFn: () =>
      getContentQuestions({
        startTs,
        endTs,
        keyword: appliedFilters.keyword,
        username: appliedFilters.username,
        tokenName: appliedFilters.tokenName,
        page,
        pageSize: PAGE_SIZE,
      }),
    staleTime: 30_000,
  })

  const enabled = termsQuery.data?.data?.enabled ?? true
  const terms = termsQuery.data?.data?.terms ?? []
  const questions = questionsQuery.data?.data?.questions ?? []
  const total = questionsQuery.data?.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const wordCloudSpec = useMemo(() => {
    if (terms.length === 0) return null
    return {
      type: 'wordCloud',
      nameField: 'term',
      valueField: 'count',
      seriesField: 'term',
      wordCloudConfig: {
        zoomToFit: { enlarge: true, fontSizeLimitMax: 56 },
      },
      data: [{ id: 'terms', values: terms }],
    } as Record<string, unknown>
  }, [terms])

  const applyFilters = () => {
    setPage(1)
    setAppliedFilters({
      keyword: keywordInput.trim(),
      username: usernameInput.trim(),
      tokenName: tokenNameInput.trim(),
    })
  }

  return (
    <div className='flex flex-col gap-4'>
      {!enabled && (
        <Alert>
          <AlertDescription>
            {t(
              'Content insight is currently disabled. Enable it in System Settings → Security to start collecting new questions; existing data is still shown below.'
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        {RANGE_DAYS.map((days) => (
          <Button
            key={days}
            size='sm'
            variant={rangeDays === days ? 'default' : 'outline'}
            onClick={() => {
              setRangeDays(days)
              setPage(1)
            }}
          >
            {t('Last {{days}} days', { days })}
          </Button>
        ))}
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <div className='border-b px-4 py-3 text-sm font-medium'>
          {t('Word Cloud')}
        </div>
        <div className='h-80 p-2'>
          {termsQuery.isLoading ? (
            <div className='text-muted-foreground flex h-full items-center justify-center'>
              <Loader2 className='size-5 animate-spin' />
            </div>
          ) : themeReady && wordCloudSpec ? (
            <VChart
              key={`wordcloud-${resolvedTheme}-${startTs}`}
              spec={{
                ...wordCloudSpec,
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

      <div className='overflow-hidden rounded-lg border'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3'>
          <div className='text-sm font-medium'>{t('Top Questions')}</div>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              className='h-8 w-40'
              placeholder={t('Keyword')}
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <Input
              className='h-8 w-32'
              placeholder={t('Username')}
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <Input
              className='h-8 w-32'
              placeholder={t('Key Name')}
              value={tokenNameInput}
              onChange={(e) => setTokenNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <Button size='sm' variant='outline' onClick={applyFilters}>
              <Search className='size-4' />
              {t('Search')}
            </Button>
          </div>
        </div>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-12'>#</TableHead>
                <TableHead>{t('Question')}</TableHead>
                <TableHead className='w-24 text-right'>
                  {t('Conversations')}
                </TableHead>
                <TableHead className='w-44'>{t('Last Asked')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questionsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className='h-24 text-center'>
                    <Loader2 className='mx-auto size-5 animate-spin' />
                  </TableCell>
                </TableRow>
              ) : questions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className='text-muted-foreground h-24 text-center'
                  >
                    {t('No data available')}
                  </TableCell>
                </TableRow>
              ) : (
                questions.map((row, index) => (
                  <TableRow key={row.question_hash}>
                    <TableCell className='text-muted-foreground'>
                      {(page - 1) * PAGE_SIZE + index + 1}
                    </TableCell>
                    <TableCell>
                      <div
                        className='max-w-xl truncate whitespace-nowrap'
                        title={row.question}
                      >
                        {row.question}
                      </div>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatNumber(row.count)}
                    </TableCell>
                    <TableCell className='text-muted-foreground tabular-nums'>
                      {formatTimestampToDate(row.last_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div
          className={cn(
            'flex items-center justify-between border-t px-4 py-2 text-sm',
            'text-muted-foreground'
          )}
        >
          <div>
            {t('{{total}} distinct questions', { total: formatNumber(total) })}
          </div>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('Previous')}
            </Button>
            <span className='tabular-nums'>
              {page} / {totalPages}
            </span>
            <Button
              size='sm'
              variant='outline'
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t('Next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
