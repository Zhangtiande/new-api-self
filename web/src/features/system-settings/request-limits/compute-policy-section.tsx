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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { JsonCodeEditor } from '@/components/json-code-editor'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  formatJsonForTextarea,
  normalizeJsonString,
  validateJsonString,
} from '../models/utils'

const schema = z.object({
  compute_policy: z.object({
    enabled: z.boolean(),
    windows: z.string().superRefine((value, ctx) => {
      const result = validateJsonString(value)
      if (!result.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.message || 'Invalid JSON',
        })
      }
    }),
  }),
})

type ComputePolicyFormValues = z.output<typeof schema>
type ComputePolicyFormInput = z.input<typeof schema>

type FlatComputePolicySettings = {
  'compute_policy.enabled': boolean
  'compute_policy.windows': string
}

type ComputePolicySectionProps = {
  defaultValues: ComputePolicyFormInput
}

const WINDOWS_PLACEHOLDER = `[
  {
    "name": "workday-peak",
    "weekdays": [1, 2, 3, 4, 5],
    "start": "09:00",
    "end": "18:00",
    "max_context_tokens": 32000,
    "tpm_limit": 100000
  }
]`

type PolicyWindow = {
  name?: string
  weekdays?: number[]
  start?: string
  end?: string
  max_context_tokens?: number
  tpm_limit?: number
}

/** Mirrors the backend "HH:MM" parser; end may be "24:00". */
function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m !== 0)) return null
  return h * 60 + m
}

/** Mirrors backend first-match semantics for the live preview. */
function matchWindowAt(windows: PolicyWindow[], now: Date): PolicyWindow | null {
  const minute = now.getHours() * 60 + now.getMinutes()
  const weekday = now.getDay()
  for (const w of windows) {
    const start = parseClock(w.start)
    const end = parseClock(w.end)
    if (start == null || end == null || start === end) continue
    if (
      Array.isArray(w.weekdays) &&
      w.weekdays.length > 0 &&
      !w.weekdays.includes(weekday)
    ) {
      continue
    }
    const inRange =
      start < end
        ? minute >= start && minute < end
        : minute >= start || minute < end
    if (inRange) return w
  }
  return null
}

export function ComputePolicySection({
  defaultValues,
}: ComputePolicySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const normalizedDefaultsRef = useRef<FlatComputePolicySettings>({
    'compute_policy.enabled': defaultValues.compute_policy.enabled,
    'compute_policy.windows': normalizeJsonString(
      defaultValues.compute_policy.windows
    ),
  })

  const buildFormDefaults = (
    values: ComputePolicyFormInput
  ): ComputePolicyFormInput => ({
    compute_policy: {
      enabled: values.compute_policy.enabled,
      windows: formatJsonForTextarea(values.compute_policy.windows),
    },
  })

  const form = useForm<
    ComputePolicyFormInput,
    unknown,
    ComputePolicyFormValues
  >({
    resolver: zodResolver(schema),
    defaultValues: buildFormDefaults(defaultValues),
  })

  useEffect(() => {
    normalizedDefaultsRef.current = {
      'compute_policy.enabled': defaultValues.compute_policy.enabled,
      'compute_policy.windows': normalizeJsonString(
        defaultValues.compute_policy.windows
      ),
    }
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const enabled = form.watch('compute_policy.enabled')
  const windowsText = form.watch('compute_policy.windows')

  const preview = useMemo(() => {
    if (!enabled) return null
    try {
      const parsed = JSON.parse(windowsText || '[]') as unknown
      if (!Array.isArray(parsed)) return null
      return { matched: matchWindowAt(parsed as PolicyWindow[], new Date()) }
    } catch {
      return null
    }
  }, [enabled, windowsText])

  const onSubmit = async (values: ComputePolicyFormValues) => {
    const normalized: FlatComputePolicySettings = {
      'compute_policy.enabled': values.compute_policy.enabled,
      'compute_policy.windows': normalizeJsonString(
        values.compute_policy.windows
      ),
    }

    const updates = (
      Object.keys(normalized) as Array<keyof FlatComputePolicySettings>
    ).filter((key) => normalized[key] !== normalizedDefaultsRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }
  }

  return (
    <SettingsSection title={t('Compute Policy')}>
      <Form {...form}>
        {/* eslint-disable-next-line react-hooks/refs */}
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='compute_policy.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Compute Policy')}</FormLabel>
                  <FormDescription>
                    {t(
                      'During matched time windows, users and keys without an explicit limit get the window default max context and tokens-per-minute (TPM). Explicit limits (positive values) always apply; -1 exempts. Outside any window, nothing is limited.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='compute_policy.windows'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Policy Windows')}</FormLabel>
                <FormControl>
                  <JsonCodeEditor
                    value={field.value}
                    onChange={field.onChange}
                    name={field.name}
                    onBlur={field.onBlur}
                    textareaRef={field.ref}
                    placeholder={WINDOWS_PLACEHOLDER}
                    aria-invalid={Boolean(
                      form.formState.errors.compute_policy?.windows
                    )}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'JSON array checked top-down (first match wins) in the server timezone. weekdays: 0=Sunday…6=Saturday, empty = every day; start/end are HH:MM with end exclusive; start later than end wraps past midnight; 0 disables that default.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {enabled && (
            <div className='text-muted-foreground rounded-md border p-3 text-sm'>
              {preview?.matched ? (
                <div>
                  {t('Currently matched window')}
                  {': '}
                  <span className='text-foreground font-medium'>
                    {preview.matched.name || `${preview.matched.start} - ${preview.matched.end}`}
                  </span>
                  {' · '}
                  {t('Max Context (tokens)')}
                  {': '}
                  {preview.matched.max_context_tokens || '∞'}
                  {' · '}
                  {t('TPM Limit (tokens/min)')}
                  {': '}
                  {preview.matched.tpm_limit || '∞'}
                </div>
              ) : (
                <div>
                  {t('No window matches now — no policy defaults apply')}
                </div>
              )}
              <div className='mt-1 text-xs'>
                {t(
                  'Preview uses this browser clock; the server evaluates windows in its own timezone.'
                )}
              </div>
            </div>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
