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
import { useEffect, useRef } from 'react'
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
} from './utils'

const schema = z.object({
  thinking_suffix: z.object({
    enabled: z.boolean(),
    rules: z.string().superRefine((value, ctx) => {
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

type ThinkingSuffixFormValues = z.output<typeof schema>
type ThinkingSuffixFormInput = z.input<typeof schema>

type FlatThinkingSuffixSettings = {
  'thinking_suffix.enabled': boolean
  'thinking_suffix.rules': string
}

type ThinkingSuffixSettingsCardProps = {
  defaultValues: ThinkingSuffixFormInput
}

const RULES_PLACEHOLDER = `[
  {
    "match": "qwen3",
    "on": { "chat_template_kwargs": { "enable_thinking": true } },
    "off": { "chat_template_kwargs": { "enable_thinking": false } }
  }
]`

export function ThinkingSuffixSettingsCard({
  defaultValues,
}: ThinkingSuffixSettingsCardProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const normalizedDefaultsRef = useRef<FlatThinkingSuffixSettings>({
    'thinking_suffix.enabled': defaultValues.thinking_suffix.enabled,
    'thinking_suffix.rules': normalizeJsonString(
      defaultValues.thinking_suffix.rules
    ),
  })

  const buildFormDefaults = (
    values: ThinkingSuffixFormInput
  ): ThinkingSuffixFormInput => ({
    thinking_suffix: {
      enabled: values.thinking_suffix.enabled,
      rules: formatJsonForTextarea(values.thinking_suffix.rules),
    },
  })

  const form = useForm<
    ThinkingSuffixFormInput,
    unknown,
    ThinkingSuffixFormValues
  >({
    resolver: zodResolver(schema),
    defaultValues: buildFormDefaults(defaultValues),
  })

  useEffect(() => {
    normalizedDefaultsRef.current = {
      'thinking_suffix.enabled': defaultValues.thinking_suffix.enabled,
      'thinking_suffix.rules': normalizeJsonString(
        defaultValues.thinking_suffix.rules
      ),
    }
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const onSubmit = async (values: ThinkingSuffixFormValues) => {
    const normalized: FlatThinkingSuffixSettings = {
      'thinking_suffix.enabled': values.thinking_suffix.enabled,
      'thinking_suffix.rules': normalizeJsonString(
        values.thinking_suffix.rules
      ),
    }

    const updates = (
      Object.keys(normalized) as Array<keyof FlatThinkingSuffixSettings>
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
    <SettingsSection title={t('Thinking Suffix (Self-hosted)')}>
      <Form {...form}>
        {/* eslint-disable-next-line react-hooks/refs */}
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='thinking_suffix.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Thinking Suffix Rules')}</FormLabel>
                  <FormDescription>
                    {t(
                      'For OpenAI-compatible self-hosted channels (sglang/vLLM): requests to `model-thinking` strip the suffix upstream and merge the on template; bare model names merge the off template. Channel param override still takes precedence.'
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
            name='thinking_suffix.rules'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Thinking Suffix Rules')}</FormLabel>
                <FormControl>
                  <JsonCodeEditor
                    value={field.value}
                    onChange={field.onChange}
                    name={field.name}
                    onBlur={field.onBlur}
                    textareaRef={field.ref}
                    placeholder={RULES_PLACEHOLDER}
                    aria-invalid={Boolean(
                      form.formState.errors.thinking_suffix?.rules
                    )}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'JSON array of rules matched by longest model-name prefix (after stripping the -thinking suffix). `on`/`off` are JSON merge patches applied to the upstream request body.'
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
