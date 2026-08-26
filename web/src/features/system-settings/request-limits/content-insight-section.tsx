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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  content_insight: z.object({
    enabled: z.boolean(),
    retention_days: z.number().int().min(0),
  }),
})

type ContentInsightFormValues = z.output<typeof schema>
type ContentInsightFormInput = z.input<typeof schema>

type FlatContentInsightSettings = {
  'content_insight.enabled': boolean
  'content_insight.retention_days': number
}

type ContentInsightSectionProps = {
  defaultValues: FlatContentInsightSettings
}

const buildFormDefaults = (
  defaults: FlatContentInsightSettings
): ContentInsightFormInput => ({
  content_insight: {
    enabled: defaults['content_insight.enabled'],
    retention_days: defaults['content_insight.retention_days'],
  },
})

export function ContentInsightSettingsSection({
  defaultValues,
}: ContentInsightSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<
    ContentInsightFormInput,
    unknown,
    ContentInsightFormValues
  >({
    resolver: zodResolver(schema),
    defaultValues: buildFormDefaults(defaultValues),
  })

  useEffect(() => {
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const onSubmit = async (values: ContentInsightFormValues) => {
    const normalized: FlatContentInsightSettings = {
      'content_insight.enabled': values.content_insight.enabled,
      'content_insight.retention_days': values.content_insight.retention_days,
    }
    const updates = (
      Object.keys(normalized) as Array<keyof FlatContentInsightSettings>
    ).filter((key) => normalized[key] !== defaultValues[key])
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }
  }

  return (
    <SettingsSection title={t('Content Insight')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='content_insight.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Content Insight')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Store the first user message of each chat request (truncated) for the admin word cloud, top-questions list and keyword search. This retains employee prompts — announce it internally before enabling. Only admins can view the data.'
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
            name='content_insight.retention_days'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Retention Days')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step={1}
                    {...field}
                    onChange={(e) =>
                      field.onChange(Number.parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Stored questions older than this are purged daily. 0 keeps them forever.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
