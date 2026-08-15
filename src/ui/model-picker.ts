/**
 * Model and provider selector.
 *
 * The selector deliberately uses a small imperative state machine instead of
 * reproducing the old Ink form. All provider operations remain available:
 * test/discover, save, save-and-select, edit, and delete.
 */

import {
  Input,
  matchesKey,
  SelectList,
  type Component,
} from '@earendil-works/pi-tui'
import type {
  RuntimeModelGroup,
  RuntimeModelSelection,
  RuntimeProviderDescriptor,
  SaveProviderInput,
} from '../harness/model-protocol.ts'
import { boxedLines, fitTerminalText, terminalWidth } from './width.ts'

const BLUE = '\u001b[38;2;77;141;255m'
const DIM = '\u001b[90m'
const RESET = '\u001b[0m'

export interface ModelPickerCallbacks {
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

type View = 'models' | 'providers' | 'form'
type FormField = 'provider' | 'model' | 'baseURL' | 'api' | 'apiKey'
type FormRow = FormField | 'test' | 'save-select' | 'save' | 'delete'

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

export class ModelPickerComponent implements Component {
  private view: View
  private groups: readonly RuntimeModelGroup[]
  private providers: readonly RuntimeProviderDescriptor[]
  private current: RuntimeModelSelection
  private models: readonly ModelRow[] = []
  private modelList: SelectList | undefined
  private providerList: SelectList | undefined
  private form: ProviderFormComponent | undefined
  private loading: boolean
  private busy = false
  private error: string | undefined

  constructor(
    initialView: 'models' | 'providers',
    groups: readonly RuntimeModelGroup[],
    providers: readonly RuntimeProviderDescriptor[],
    current: RuntimeModelSelection,
    private readonly callbacks: ModelPickerCallbacks,
  ) {
    this.view = initialView
    this.groups = groups
    this.providers = providers
    this.current = current
    this.loading = groups.length === 0 && providers.length === 0
    this.rebuildLists()
  }

  setCatalog(
    groups: readonly RuntimeModelGroup[],
    providers: readonly RuntimeProviderDescriptor[],
    current: RuntimeModelSelection,
  ): void {
    this.groups = groups
    this.providers = providers
    this.current = current
    this.loading = false
    this.error = undefined
    this.rebuildLists()
  }

  setLoading(): void {
    this.loading = true
    this.busy = false
    this.error = undefined
  }

  setBusy(busy: boolean): void {
    this.busy = busy
  }

  setError(error: string | undefined): void {
    this.loading = false
    this.busy = false
    this.error = error
  }

  render(width: number): string[] {
    const frameWidth = terminalWidth(width)
    if (frameWidth === 0) return []
    const innerWidth = Math.max(1, frameWidth - 4)
    const title = this.view === 'models' ? 'Models' : this.view === 'providers' ? 'Providers' : 'Provider configuration'
    const lines = [
      `${BLUE}${title}${RESET}`,
      `${DIM}${this.view === 'form'
        ? '↑↓ field · Enter edit/action · Esc back'
        : '↑↓ navigate · Enter select/open · Esc close'}${RESET}`,
    ]
    if (this.loading) {
      lines.push(`${BLUE}Loading provider and model catalogs…${RESET}`)
    } else if (this.error !== undefined) {
      lines.push(`\u001b[31m${fitTerminalText(this.error, innerWidth)}${RESET}`)
    } else if (this.view === 'models') {
      lines.push(...(this.modelList?.render(innerWidth) ?? [`${DIM}No models available.${RESET}`]))
      lines.push(`${DIM}Configure providers: select the final item or use /provider.${RESET}`)
    } else if (this.view === 'providers') {
      lines.push(...(this.providerList?.render(innerWidth) ?? [`${DIM}No providers available.${RESET}`]))
    } else if (this.form !== undefined) {
      lines.push(...this.form.render(innerWidth))
    }
    if (this.busy) lines.push(`${BLUE}Working…${RESET}`)
    return boxedLines(lines, frameWidth)
  }

  handleInput(data: string): void {
    if (this.view === 'form') {
      this.form?.handleInput(data)
      return
    }
    if (matchesKey(data, 'escape')) {
      this.callbacks.onCancel()
      return
    }
    if (this.view === 'models') this.modelList?.handleInput(data)
    else this.providerList?.handleInput(data)
  }

  invalidate(): void {
    this.modelList?.invalidate()
    this.providerList?.invalidate()
    this.form?.invalidate()
  }

  private rebuildLists(): void {
    this.models = this.groups.flatMap((group) => group.models.map((model) => ({
      provider: group.id,
      providerName: group.name,
      model: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
    })))
    this.modelList = new SelectList([
      ...this.models.map((row) => ({
        value: `${row.provider}/${row.model}`,
        label: row.model,
        description: `${row.providerName}${row.description === undefined ? '' : ` · ${row.description}`}${row.provider === this.current.provider && row.model === this.current.model ? ' · current' : ''}`,
      })),
      { value: '__providers__', label: 'Configure providers', description: 'Add, edit, test, or delete provider routes' },
    ], 10, selectTheme())
    this.modelList.onSelect = (item) => {
      if (item.value === '__providers__') {
        this.view = 'providers'
        this.providerList?.setFilter('')
        this.rebuildLists()
        return
      }
      const separator = item.value.indexOf('/')
      if (separator > 0) this.callbacks.onSelect(item.value.slice(0, separator), item.value.slice(separator + 1))
    }
    this.modelList.onCancel = this.callbacks.onCancel

    this.providerList = new SelectList([
      ...this.providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
        description: `${provider.id} · ${providerStatus(provider)}${provider.id === this.current.provider ? ' · current' : ''}`,
      })),
      { value: '__new__', label: 'Add custom provider', description: 'Configure an OpenAI-compatible provider route' },
    ], 10, selectTheme())
    this.providerList.onSelect = (item) => {
      if (item.value === '__new__') {
        this.openForm(undefined)
        return
      }
      this.openForm(this.providers.find((provider) => provider.id === item.value))
    }
    this.providerList.onCancel = this.callbacks.onCancel
  }

  private openForm(provider: RuntimeProviderDescriptor | undefined): void {
    this.view = 'form'
    this.form = new ProviderFormComponent(
      provider,
      this.current,
      {
        onBack: () => {
          this.view = 'providers'
          this.form = undefined
          this.rebuildLists()
        },
        onTest: (input) => this.callbacks.onTestProvider(input),
        onSave: (input) => this.callbacks.onSaveProvider(input),
        onDelete: (id) => this.callbacks.onDeleteProvider(id),
      },
    )
  }
}

interface ProviderFormCallbacks {
  onBack: () => void
  onTest: (input: Omit<SaveProviderInput, 'model' | 'select'>) => void
  onSave: (input: SaveProviderInput) => void
  onDelete: (provider: string) => void
}

class ProviderFormComponent implements Component {
  private readonly provider?: RuntimeProviderDescriptor
  private readonly current: RuntimeModelSelection
  private readonly callbacks: ProviderFormCallbacks
  private readonly inputs: Record<FormField, Input>
  private selected = 0
  private editing = false
  private rows: readonly FormRow[]
  private message: string | undefined

  constructor(
    provider: RuntimeProviderDescriptor | undefined,
    current: RuntimeModelSelection,
    callbacks: ProviderFormCallbacks,
  ) {
    this.provider = provider
    this.current = current
    this.callbacks = callbacks
    const values = providerForm(provider, current)
    this.inputs = {
      provider: new Input(),
      model: new Input(),
      baseURL: new Input(),
      api: new Input(),
      apiKey: new Input(),
    }
    for (const field of FORM_FIELDS) {
      this.inputs[field].setValue(values[field])
      this.inputs[field].onEscape = () => {
        this.editing = false
        this.inputs[field].focused = false
      }
      this.inputs[field].onSubmit = () => {
        this.editing = false
        this.inputs[field].focused = false
      }
    }
    this.rows = [
      ...FORM_FIELDS,
      'test',
      'save-select',
      'save',
      ...(provider !== undefined && provider.builtIn === false ? ['delete' as const] : []),
    ]
  }

  render(width: number): string[] {
    const lines: string[] = []
    for (const [index, row] of this.rows.entries()) {
      const active = index === this.selected
      const prefix = active ? `${BLUE}›${RESET}` : ' '
      if (FORM_FIELDS.includes(row as FormField)) {
        const field = row as FormField
        const value = this.inputs[field].getValue()
        const readOnly = this.isReadOnly(field)
        const status = field === 'apiKey' && value === ''
          ? this.provider?.credentialConfigured === true
            ? `configured from ${this.provider.credentialSource ?? 'credential store'}`
            : 'not configured'
          : value === ''
            ? '(provider default)'
            : field === 'apiKey'
              ? '•'.repeat(Math.min(24, value.length))
              : value
        lines.push(`${prefix} ${FORM_LABELS[field]}: ${readOnly ? `${status} [read-only]` : status}`)
        if (active && this.editing) {
          lines.push(...this.inputs[field].render(Math.max(1, width - 2)))
        }
      } else {
        const label = row === 'test'
          ? 'Test connection / discover models'
          : row === 'save-select'
            ? 'Save and use'
            : row === 'save'
              ? 'Save configuration'
              : this.provider?.id === this.current.provider
                ? 'Delete provider (switch away first)'
                : 'Delete provider'
        lines.push(`${prefix} ${label}`)
      }
    }
    if (this.message !== undefined) lines.push(`${DIM}${this.message}${RESET}`)
    return lines.map((line) => fitTerminalText(line, terminalWidth(width), ''))
  }

  handleInput(data: string): void {
    if (this.editing) {
      const field = this.rows[this.selected]
      if (field !== undefined && FORM_FIELDS.includes(field as FormField)) {
        this.inputs[field as FormField].handleInput(data)
      }
      return
    }
    if (matchesKey(data, 'escape')) {
      this.callbacks.onBack()
      return
    }
    if (matchesKey(data, 'up')) {
      this.selected = (this.selected - 1 + this.rows.length) % this.rows.length
      return
    }
    if (matchesKey(data, 'down') || matchesKey(data, 'tab')) {
      this.selected = (this.selected + 1) % this.rows.length
      return
    }
    if (!matchesKey(data, 'enter')) return
    const row = this.rows[this.selected]
    if (row === undefined) return
    if (FORM_FIELDS.includes(row as FormField)) {
      const field = row as FormField
      if (this.isReadOnly(field)) return
      this.editing = true
      this.inputs[field].focused = true
      return
    }
    const provider = this.inputs.provider.getValue().trim()
    const model = this.inputs.model.getValue().trim()
    if (row === 'test') {
      if (provider === '') {
        this.message = 'Provider route is required before testing.'
        return
      }
      this.callbacks.onTest({
        provider,
        baseURL: this.inputs.baseURL.getValue().trim(),
        api: this.inputs.api.getValue().trim(),
        ...(this.inputs.apiKey.getValue() === '' ? {} : { apiKey: this.inputs.apiKey.getValue() }),
      })
      return
    }
    if (row === 'save' || row === 'save-select') {
      if (provider === '') {
        this.message = 'Provider route is required before saving.'
        return
      }
      this.callbacks.onSave({
        provider,
        ...(model === '' ? {} : { model }),
        baseURL: this.inputs.baseURL.getValue().trim(),
        api: this.inputs.api.getValue().trim(),
        ...(this.inputs.apiKey.getValue() === '' ? {} : { apiKey: this.inputs.apiKey.getValue() }),
        select: row === 'save-select',
      })
      return
    }
    if (row === 'delete' && this.provider !== undefined && this.provider.id !== this.current.provider) {
      this.callbacks.onDelete(this.provider.id)
    }
  }

  invalidate(): void {}

  private isReadOnly(field: FormField): boolean {
    return (field === 'provider' && this.provider !== undefined)
      || (field === 'apiKey' && this.provider?.credentialWritable === false)
  }
}

function selectTheme() {
  return {
    selectedPrefix: (text: string) => `${BLUE}${text}${RESET}`,
    selectedText: (text: string) => `${BLUE}${text}${RESET}`,
    description: (text: string) => `${DIM}${text}${RESET}`,
    scrollInfo: (text: string) => `${DIM}${text}${RESET}`,
    noMatch: (text: string) => `${DIM}${text}${RESET}`,
  }
}

function providerStatus(provider: RuntimeProviderDescriptor): string {
  return [
    provider.configured ? 'configured' : provider.active ? 'available' : 'not configured',
    provider.credentialConfigured ? `key: ${provider.credentialSource ?? 'configured'}` : 'key: missing',
  ].join(' · ')
}
