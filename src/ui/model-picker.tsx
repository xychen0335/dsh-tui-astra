/** Searchable model selector plus editable Provider manager opened by /model. */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Box, Text, useInput } from 'ink'
import type {
  RuntimeModelGroup,
  RuntimeModelSelection,
  RuntimeProviderDescriptor,
  SaveProviderInput,
} from '../harness/model-protocol.ts'
import { DEEPSEEK_BLUE, DEEPSEEK_BLUE_DARK } from './theme.ts'
import { isMouseReport } from './terminal-input.ts'
import { nextGraphemeBoundary, previousGraphemeBoundary } from './input.tsx'

export interface ModelPickerProps {
  groups: readonly RuntimeModelGroup[]
  providers: readonly RuntimeProviderDescriptor[]
  current: RuntimeModelSelection
  loading: boolean
  busy: boolean
  error?: string
  onSelect: (provider: string, model: string) => void
  onSaveProvider: (input: SaveProviderInput) => void
  onTestProvider: (input: Omit<SaveProviderInput, 'model' | 'select'>) => void
  onDeleteProvider: (provider: string) => void
  onCancel: () => void
}

interface ModelRow {
  provider: string
  providerName: string
  model: string
  name: string
  description?: string
}

type View = 'models' | 'providers' | 'editor'
type FormField = 'provider' | 'model' | 'baseURL' | 'api' | 'apiKey'
type EditorRow = FormField | 'test' | 'save-select' | 'save' | 'delete'

interface ProviderForm {
  provider: string
  model: string
  baseURL: string
  api: string
  apiKey: string
}

const FORM_FIELDS: readonly FormField[] = ['provider', 'model', 'baseURL', 'api', 'apiKey']
const FORM_LABELS: Record<FormField, string> = {
  provider: 'Provider route',
  model: 'Default model',
  baseURL: 'Base URL',
  api: 'Protocol',
  apiKey: 'API key',
}

/** Build an editable form without ever receiving the stored secret value. */
export function providerForm(
  provider?: RuntimeProviderDescriptor,
  current?: RuntimeModelSelection,
): ProviderForm {
  return {
    provider: provider?.id ?? '',
    model: provider?.model ?? (provider !== undefined && current !== undefined && provider.id === current.provider
      ? current.model
      : ''),
    baseURL: provider?.baseURL ?? '',
    api: provider?.api ?? (provider === undefined ? 'openai-completions' : ''),
    apiKey: '',
  }
}

/** Case-insensitive provider/model search shared by the interactive selector. */
export function matchesModelQuery(row: ModelRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const haystack = `${row.provider}/${row.model} ${row.providerName} ${row.name} ${row.description ?? ''}`
    .toLowerCase()
  let cursor = 0
  for (const character of needle) {
    cursor = haystack.indexOf(character, cursor)
    if (cursor < 0) return false
    cursor += 1
  }
  return true
}

export function ModelPicker({
  groups,
  providers,
  current,
  loading,
  busy,
  error,
  onSelect,
  onSaveProvider,
  onTestProvider,
  onDeleteProvider,
  onCancel,
}: ModelPickerProps): JSX.Element {
  const models = useMemo<readonly ModelRow[]>(() => groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    providerName: group.name,
    model: model.id,
    name: model.name,
    ...(model.description === undefined ? {} : { description: model.description }),
  }))), [groups])
  const [view, setView] = useState<View>('models')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [editingProvider, setEditingProvider] = useState<RuntimeProviderDescriptor | undefined>()
  const [form, setForm] = useState<ProviderForm>(() => providerForm())
  const [editorIndex, setEditorIndex] = useState(0)
  const [editingField, setEditingField] = useState(false)
  const [fieldCursor, setFieldCursor] = useState(0)
  const [selectAll, setSelectAll] = useState(false)

  const filteredModels = useMemo(
    () => models.filter(row => matchesModelQuery(row, query)),
    [models, query],
  )
  const filteredProviders = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...providers]
      .sort((left, right) => {
        const leftRank = left.configured ? 0 : left.active ? 1 : 2
        const rightRank = right.configured ? 0 : right.active ? 1 : 2
        return leftRank - rightRank || left.name.localeCompare(right.name)
      })
      .filter(provider => needle === ''
        || `${provider.id} ${provider.name}`.toLowerCase().includes(needle))
  }, [providers, query])
  const editorRows = useMemo<readonly EditorRow[]>(() => [
    ...FORM_FIELDS,
    'test',
    'save-select',
    'save',
    ...(editingProvider?.configured === true && editingProvider.builtIn === false ? ['delete' as const] : []),
  ], [editingProvider])

  useEffect(() => {
    if (view !== 'models' || query !== '') return
    const currentIndex = filteredModels.findIndex(
      row => row.provider === current.provider && row.model === current.model,
    )
    setSelected(currentIndex < 0 ? 0 : currentIndex)
  }, [current.model, current.provider, filteredModels, query, view])

  useEffect(() => {
    const length = view === 'models' ? filteredModels.length : view === 'providers' ? filteredProviders.length + 1 : editorRows.length
    setSelected(index => Math.min(index, Math.max(0, length - 1)))
  }, [editorRows.length, filteredModels.length, filteredProviders.length, view])

  const openEditor = (provider?: RuntimeProviderDescriptor): void => {
    setEditingProvider(provider)
    setForm(providerForm(provider, current))
    setEditorIndex(0)
    setEditingField(false)
    setFieldCursor(0)
    setSelectAll(false)
    setView('editor')
  }

  useInput((input, key) => {
    if (isMouseReport(input)) return
    if (key.escape) {
      if (view === 'editor') {
        if (editingField) setEditingField(false)
        else {
          setView('providers')
          setQuery('')
          setSelected(0)
        }
      } else onCancel()
      return
    }
    if (loading || busy) return

    if (view !== 'editor') {
      if (key.tab) {
        setView(currentView => currentView === 'models' ? 'providers' : 'models')
        setQuery('')
        setSelected(0)
        return
      }
      const length = view === 'models' ? filteredModels.length : filteredProviders.length + 1
      if (key.upArrow && length > 0) {
        setSelected(index => (index - 1 + length) % length)
        return
      }
      if (key.downArrow && length > 0) {
        setSelected(index => (index + 1) % length)
        return
      }
      if (key.return) {
        if (view === 'models') {
          const row = filteredModels[selected]
          if (row !== undefined) onSelect(row.provider, row.model)
        } else {
          const provider = filteredProviders[selected]
          openEditor(provider)
        }
        return
      }
      if (key.backspace || key.delete) {
        setQuery(value => value.slice(0, -1))
        setSelected(0)
        return
      }
      if (key.ctrl || key.meta || input === '') return
      setQuery(value => value + input)
      setSelected(0)
      return
    }

    const row = editorRows[editorIndex] as EditorRow
    if (editingField && FORM_FIELDS.includes(row as FormField)) {
      const field = row as FormField
      if (key.return || key.tab) {
        setEditingField(false)
        setSelectAll(false)
        if (key.tab) setEditorIndex(index => Math.min(editorRows.length - 1, index + 1))
        return
      }
      if (key.ctrl && input.toLowerCase() === 'a') {
        setSelectAll(true)
        setFieldCursor(form[field].length)
        return
      }
      if (key.leftArrow) {
        if (selectAll) {
          setSelectAll(false)
          setFieldCursor(0)
        } else {
          setFieldCursor(cursor => previousGraphemeBoundary(form[field], cursor))
        }
        return
      }
      if (key.rightArrow) {
        if (selectAll) {
          setSelectAll(false)
          setFieldCursor(form[field].length)
        } else {
          setFieldCursor(cursor => nextGraphemeBoundary(form[field], cursor))
        }
        return
      }
      if (key.backspace || key.delete) {
        if (selectAll) {
          setForm(value => ({ ...value, [field]: '' }))
          setFieldCursor(0)
          setSelectAll(false)
          return
        }
        if (fieldCursor === 0) return
        const previous = previousGraphemeBoundary(form[field], fieldCursor)
        setForm(value => ({
          ...value,
          [field]: value[field].slice(0, previous) + value[field].slice(fieldCursor),
        }))
        setFieldCursor(previous)
        return
      }
      if (key.ctrl || key.meta || input === '') return
      setForm(value => ({
        ...value,
        [field]: selectAll
          ? input
          : value[field].slice(0, fieldCursor) + input + value[field].slice(fieldCursor),
      }))
      setFieldCursor(cursor => selectAll ? input.length : cursor + input.length)
      setSelectAll(false)
      return
    }

    if (key.upArrow) {
      setEditorIndex(index => (index - 1 + editorRows.length) % editorRows.length)
      return
    }
    if (key.downArrow || key.tab) {
      setEditorIndex(index => (index + 1) % editorRows.length)
      return
    }
    if (!key.return) return
    if (FORM_FIELDS.includes(row as FormField)) {
      if (row === 'provider' && editingProvider !== undefined) return
      if (row === 'apiKey' && editingProvider?.credentialWritable === false) return
      setEditingField(true)
      const field = row as FormField
      setFieldCursor(form[field].length)
      setSelectAll(false)
      return
    }
    const provider = form.provider.trim()
    const model = form.model.trim()
    if (row === 'test' && provider !== '') {
      onTestProvider({
        provider,
        baseURL: form.baseURL.trim(),
        api: form.api.trim(),
        ...(form.apiKey === '' ? {} : { apiKey: form.apiKey }),
      })
      return
    }
    if ((row === 'save' || row === 'save-select') && provider !== '') {
      onSaveProvider({
        provider,
        ...(model === '' ? {} : { model }),
        baseURL: form.baseURL.trim(),
        api: form.api.trim(),
        ...(form.apiKey === '' ? {} : { apiKey: form.apiKey }),
        select: row === 'save-select',
      })
      return
    }
    if (row === 'delete' && editingProvider !== undefined && editingProvider.id !== current.provider) {
      onDeleteProvider(editingProvider.id)
    }
  })

  const title = view === 'models' ? 'Models' : view === 'providers' ? 'Providers' : `Provider · ${editingProvider?.name ?? 'New'}`
  const hint = view === 'editor'
    ? (editingField ? 'Type value  Enter done  Esc cancel edit' : '↑↓ field  Enter edit/action  Esc providers')
    : 'Tab models/providers  Type search  ↑↓ navigate  Enter open  Esc close'

  return (
    <Box flexDirection="column" marginX={1} borderStyle="round" borderColor={DEEPSEEK_BLUE} paddingX={1}>
      <Box>
        <Text color={DEEPSEEK_BLUE} bold>{title}</Text>
        <Box flexGrow={1} />
        <Text dimColor>{hint}</Text>
      </Box>
      {view !== 'editor' && (
        <Text dimColor>  Search: {query === '' ? 'type to filter' : query}</Text>
      )}
      {loading && <Text color={DEEPSEEK_BLUE}>  Loading provider and model catalogs…</Text>}
      {error !== undefined && <Text color="red">  {error}</Text>}
      {busy && <Text color={DEEPSEEK_BLUE}>  Saving…</Text>}

      {!loading && view === 'models' && (
        <ModelRows rows={filteredModels} selected={selected} current={current} />
      )}
      {!loading && view === 'providers' && (
        <>
          {filteredProviders.map((provider, index) => (
            <ProviderRow key={provider.id} provider={provider} active={index === selected} current={current.provider === provider.id} />
          ))}
          <Text color={selected === filteredProviders.length ? DEEPSEEK_BLUE : 'gray'} bold={selected === filteredProviders.length}>
            {selected === filteredProviders.length ? '› ' : '  '}＋ Add custom provider
          </Text>
        </>
      )}
      {!loading && view === 'editor' && editorRows.map((row, index) => (
        <EditorLine
          key={row}
          row={row}
          active={index === editorIndex}
          editing={editingField && index === editorIndex}
          cursor={fieldCursor}
          selectAll={selectAll}
          form={form}
          provider={editingProvider}
          current={current}
        />
      ))}
    </Box>
  )
}

function ModelRows({
  rows,
  selected,
  current,
}: {
  rows: readonly ModelRow[]
  selected: number
  current: RuntimeModelSelection
}): JSX.Element {
  if (rows.length === 0) return <Text dimColor>  No matching models. Press Tab to configure a provider.</Text>
  const maxVisible = 10
  const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), rows.length - maxVisible))
  const visible = rows.slice(start, start + maxVisible)
  return (
    <>
      {visible.map((row, offset) => {
        const index = start + offset
        const active = index === selected
        const currentRoute = row.provider === current.provider && row.model === current.model
        return (
          <Box key={`${row.provider}/${row.model}`}>
            <Text color={active ? DEEPSEEK_BLUE : 'gray'} bold={active}>{active ? '› ' : '  '}</Text>
            <Text
              color={active ? 'white' : undefined}
              backgroundColor={active ? DEEPSEEK_BLUE_DARK : undefined}
              bold={active}
            >
              {row.model}
            </Text>
            <Text dimColor>  [{row.provider}]</Text>
            {currentRoute && <Text color="green">  current</Text>}
          </Box>
        )
      })}
      {rows.length > maxVisible && <Text dimColor>  {selected + 1}/{rows.length}</Text>}
      {rows[selected] !== undefined && <Text dimColor>  {rows[selected]?.name}{rows[selected]?.description === undefined ? '' : ` · ${rows[selected]?.description}`}</Text>}
    </>
  )
}

function ProviderRow({
  provider,
  active,
  current,
}: {
  provider: RuntimeProviderDescriptor
  active: boolean
  current: boolean
}): JSX.Element {
  const status = [
    provider.configured ? 'configured' : provider.active ? 'available' : 'not configured',
    provider.credentialConfigured ? `key: ${provider.credentialSource ?? 'configured'}` : 'key: missing',
  ].join(' · ')
  return (
    <Box>
      <Text color={active ? DEEPSEEK_BLUE : 'gray'} bold={active}>{active ? '› ' : '  '}</Text>
      <Text
        color={active ? 'white' : undefined}
        backgroundColor={active ? DEEPSEEK_BLUE_DARK : undefined}
        bold={active}
      >
        {provider.name}
      </Text>
      <Text dimColor>  {provider.id} · {status}</Text>
      {current && <Text color="green">  current</Text>}
    </Box>
  )
}

function EditorLine({
  row,
  active,
  editing,
  cursor,
  selectAll,
  form,
  provider,
  current,
}: {
  row: EditorRow
  active: boolean
  editing: boolean
  cursor: number
  selectAll: boolean
  form: ProviderForm
  provider?: RuntimeProviderDescriptor
  current: RuntimeModelSelection
}): JSX.Element {
  const prefix = active ? '› ' : '  '
  if (!FORM_FIELDS.includes(row as FormField)) {
    const label = row === 'test'
      ? 'Test connection / discover models'
      : row === 'save-select'
      ? 'Save and use'
      : row === 'save'
        ? 'Save configuration'
        : provider?.id === current.provider
          ? 'Delete provider (switch away first)'
          : 'Delete provider'
    return <Text color={active ? (row === 'delete' ? 'red' : DEEPSEEK_BLUE) : 'gray'} bold={active}>{prefix}{label}</Text>
  }
  const field = row as FormField
  const raw = form[field]
  let value = raw
  if (field === 'apiKey') {
    value = raw === ''
      ? provider?.credentialConfigured === true
        ? provider.credentialWritable
          ? `(configured from ${provider.credentialSource ?? 'credential store'}; Enter to replace)`
          : `(read-only from ${provider.credentialSource ?? 'environment'})`
        : '(not configured; Enter to add)'
      : '•'.repeat(Math.min(32, raw.length))
  } else if (raw === '') {
    value = field === 'baseURL' || field === 'api' ? '(provider default)' : '(required)'
  }
  const readOnly = (field === 'provider' && provider !== undefined)
    || (field === 'apiKey' && provider?.credentialWritable === false)
  const displayValue = field === 'apiKey' && raw !== '' ? '•'.repeat(raw.length) : raw
  return (
    <Box>
      <Text color={active ? DEEPSEEK_BLUE : 'gray'}>{prefix}</Text>
      <Text bold={active}>{FORM_LABELS[field]}: </Text>
      {editing ? (
        selectAll ? (
          <Text color="yellow" inverse>{displayValue === '' ? ' ' : displayValue}</Text>
        ) : (
          <Text color="yellow">
            {displayValue.slice(0, cursor)}
            <Text inverse>{displayValue.slice(cursor, cursor + 1) || ' '}</Text>
            {displayValue.slice(cursor + 1)}
          </Text>
        )
      ) : (
        <Text color={active ? 'white' : undefined}>{value}</Text>
      )}
      {readOnly && <Text dimColor>  read-only</Text>}
    </Box>
  )
}
