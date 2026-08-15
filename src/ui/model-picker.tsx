/** Interactive model selector and custom-provider form opened by /model. */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Box, Text, useInput } from 'ink'
import type {
  ConfigureProviderInput,
  RuntimeModelGroup,
  RuntimeModelSelection,
} from '../harness/model-protocol.ts'
import { DEEPSEEK_BLUE, DEEPSEEK_BLUE_DARK } from './theme.ts'
import { isMouseReport } from './terminal-input.ts'

export interface ModelPickerProps {
  groups: readonly RuntimeModelGroup[]
  current: RuntimeModelSelection
  loading: boolean
  busy: boolean
  error?: string
  onSelect: (provider: string, model: string) => void
  onConfigure: (input: ConfigureProviderInput) => void
  onCancel: () => void
}

interface ModelRow {
  kind: 'model'
  provider: string
  providerName: string
  model: string
  name: string
  description?: string
}

interface AddRow {
  kind: 'add'
}

type PickerRow = ModelRow | AddRow
type FormField = 'provider' | 'model' | 'baseURL' | 'api' | 'apiKey'

const FORM_FIELDS: readonly FormField[] = ['provider', 'model', 'baseURL', 'api', 'apiKey']
const FORM_LABELS: Record<FormField, string> = {
  provider: 'Provider route',
  model: 'Model id',
  baseURL: 'Base URL (optional for known providers)',
  api: 'Protocol (optional; e.g. openai-completions)',
  apiKey: 'API key (optional if already configured)',
}

export function ModelPicker({
  groups,
  current,
  loading,
  busy,
  error,
  onSelect,
  onConfigure,
  onCancel,
}: ModelPickerProps): JSX.Element {
  const rows = useMemo<readonly PickerRow[]>(() => [
    ...groups.flatMap((group) => group.models.map((model): ModelRow => ({
      kind: 'model',
      provider: group.id,
      providerName: group.name,
      model: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
    }))),
    { kind: 'add' },
  ], [groups])
  const [selected, setSelected] = useState(0)
  const [form, setForm] = useState<Record<FormField, string> | null>(null)
  const [fieldIndex, setFieldIndex] = useState(0)

  useEffect(() => {
    const currentIndex = rows.findIndex(row => row.kind === 'model'
      && row.provider === current.provider
      && row.model === current.model)
    setSelected(currentIndex < 0 ? 0 : currentIndex)
  }, [current.model, current.provider, rows])

  useInput((input, key) => {
    // Transcript scrolling enables SGR mouse reporting globally. Ink may pass
    // those reports through as text; never persist them into provider fields
    // or credentials.
    if (isMouseReport(input)) return
    if (key.escape) {
      if (form !== null) {
        setForm(null)
        setFieldIndex(0)
      } else onCancel()
      return
    }
    if (loading || busy) return
    if (form === null) {
      if (key.upArrow) {
        setSelected(current => (current - 1 + rows.length) % rows.length)
        return
      }
      if (key.downArrow) {
        setSelected(current => (current + 1) % rows.length)
        return
      }
      if (key.return) {
        const row = rows[selected]
        if (row?.kind === 'model') onSelect(row.provider, row.model)
        else if (row?.kind === 'add') {
          setForm({ provider: '', model: '', baseURL: '', api: '', apiKey: '' })
          setFieldIndex(0)
        }
      }
      return
    }

    const field = FORM_FIELDS[fieldIndex] as FormField
    if (key.return) {
      if (fieldIndex < FORM_FIELDS.length - 1) {
        setFieldIndex(current => current + 1)
        return
      }
      if (form.provider.trim() === '' || form.model.trim() === '') return
      onConfigure({
        provider: form.provider.trim(),
        model: form.model.trim(),
        ...(form.baseURL.trim() === '' ? {} : { baseURL: form.baseURL.trim() }),
        ...(form.api.trim() === '' ? {} : { api: form.api.trim() }),
        ...(form.apiKey === '' ? {} : { apiKey: form.apiKey }),
      })
      return
    }
    if (key.upArrow) {
      setFieldIndex(current => Math.max(0, current - 1))
      return
    }
    if (key.downArrow || key.tab) {
      setFieldIndex(current => Math.min(FORM_FIELDS.length - 1, current + 1))
      return
    }
    if (key.backspace || key.delete) {
      setForm(current => current === null ? current : { ...current, [field]: current[field].slice(0, -1) })
      return
    }
    if (key.ctrl || key.meta || input === '') return
    setForm(current => current === null ? current : { ...current, [field]: current[field] + input })
  })

  return (
    <Box flexDirection="column" marginX={1} borderStyle="round" borderColor={DEEPSEEK_BLUE} paddingX={1}>
      <Box>
        <Text color={DEEPSEEK_BLUE} bold>{form === null ? 'Select a model' : 'Configure a provider'}</Text>
        <Box flexGrow={1} />
        <Text dimColor>{form === null ? '↑↓ navigate  Enter select  Esc close' : '↑↓ field  Enter next/save  Esc back'}</Text>
      </Box>
      {loading && <Text color={DEEPSEEK_BLUE}>  Loading model catalog…</Text>}
      {error !== undefined && <Text color="red">  {error}</Text>}
      {busy && <Text color={DEEPSEEK_BLUE}>  Applying configuration…</Text>}
      {!loading && form === null && rows.map((row, index) => {
        const active = index === selected
        if (row.kind === 'add') {
          return (
            <Text key="add" color={active ? DEEPSEEK_BLUE : 'gray'} bold={active}>
              {active ? '› ' : '  '}＋ Add or configure provider
            </Text>
          )
        }
        const currentRoute = row.provider === current.provider && row.model === current.model
        return (
          <Box key={`${row.provider}/${row.model}`}>
            <Text color={active ? DEEPSEEK_BLUE : 'gray'} bold={active}>{active ? '› ' : '  '}</Text>
            <Text
              color={active ? 'white' : undefined}
              backgroundColor={active ? DEEPSEEK_BLUE_DARK : undefined}
              bold={active}
            >
              {row.providerName} / {row.name}
            </Text>
            {currentRoute && <Text color="green">  current</Text>}
            {row.description !== undefined && <Text dimColor>  {row.description}</Text>}
          </Box>
        )
      })}
      {!loading && form !== null && FORM_FIELDS.map((field, index) => {
        const active = index === fieldIndex
        const raw = form[field]
        const value = field === 'apiKey' && raw !== '' ? '•'.repeat(Math.min(24, raw.length)) : raw
        return (
          <Box key={field}>
            <Text color={active ? DEEPSEEK_BLUE : 'gray'}>{active ? '› ' : '  '}</Text>
            <Text bold={active}>{FORM_LABELS[field]}: </Text>
            <Text color={active ? 'white' : undefined}>{value === '' ? '—' : value}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
