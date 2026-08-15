/** Read-only discovery and decoding of native Harness JSONL sessions. */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface SavedSession {
  id: string
  updatedAt: number
  workspace: string
  title?: string
}

export interface LoadedSession extends SavedSession {
  events: readonly SessionEvent[]
}

interface SessionArtifact {
  id: string
  updatedAt: number
  projectDirectory: string
  path: string
  compressed: boolean
}

/** List recent sessions across the whole configured store. */
export async function listSessions(
  root: string,
  _preferredWorkspace?: string,
  limit = 8,
): Promise<readonly SavedSession[]> {
  const artifacts = await findArtifacts(root)
  const sessions = await Promise.all(artifacts.map(async (artifact): Promise<SavedSession & { artifact: SessionArtifact }> => {
    const header = await readHeader(artifact)
    return {
      id: header.id,
      updatedAt: artifact.updatedAt,
      workspace: header.cwd ?? decodeProjectDirectory(artifact.projectDirectory),
      artifact,
    }
  }))
  const recent = sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  return Promise.all(recent.map(async ({ artifact, ...session }): Promise<SavedSession> => {
    const title = await readSessionTitle(artifact)
    return { ...session, ...(title === undefined ? {} : { title }) }
  }))
}

/** Backwards-compatible current-workspace filter used by older callers. */
export async function listWorkspaceSessions(root: string, workspace: string, limit = 8): Promise<readonly SavedSession[]> {
  const key = projectKey(workspace)
  return (await listSessions(root, workspace, Number.POSITIVE_INFINITY))
    .filter((session) => projectKey(session.workspace) === key)
    .slice(0, limit)
}

/** Find and decode one session by id across all project partitions. */
export async function loadSession(root: string, id: string): Promise<LoadedSession | undefined> {
  const matches = (await findArtifacts(root)).filter((artifact) => artifact.id === id)
  if (matches.length === 0) return undefined
  if (matches.length > 1) throw new Error(`duplicate session id ${id}`)
  const artifact = matches[0]
  if (artifact === undefined) return undefined
  const text = await readArtifact(artifact)
  const lines = text.split('\n').filter((line) => line.length > 0)
  const first = lines.shift()
  if (first === undefined) throw new Error(`empty session log for ${id}`)
  const header = parseHeader(first)
  if (header.id !== id) throw new Error(`session header id does not match ${id}`)
  const events: SessionEvent[] = []
  let title: string | undefined
  for (const line of lines) {
    const record = JSON.parse(line) as unknown
    if (isSessionTitle(record)) title = record.data.title.trim()
    events.push(...decodeStorageRecord(record))
  }
  return {
    id,
    updatedAt: artifact.updatedAt,
    workspace: header.cwd ?? decodeProjectDirectory(artifact.projectDirectory),
    ...(title === undefined ? {} : { title }),
    events,
  }
}

async function findArtifacts(root: string): Promise<readonly SessionArtifact[]> {
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const nested = await Promise.all(projects
    .filter((entry) => entry.isDirectory())
    .map(async (project): Promise<readonly SessionArtifact[]> => {
      const projectPath = join(root, project.name)
      const entries = await readdir(projectPath, { withFileTypes: true })
      const artifacts = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<SessionArtifact | undefined> => {
          for (const [filename, compressed] of [['session.jsonl.zstd', true], ['session.jsonl', false]] as const) {
            const path = join(projectPath, entry.name, filename)
            try {
              const info = await stat(path)
              return {
                id: decodeSegment(entry.name),
                updatedAt: info.mtimeMs,
                projectDirectory: project.name,
                path,
                compressed,
              }
            } catch (error) {
              if (!isMissing(error)) throw error
            }
          }
          return undefined
        }))
      return artifacts.filter((artifact): artifact is SessionArtifact => artifact !== undefined)
    }))
  return nested.flat()
}

async function readHeader(artifact: SessionArtifact): Promise<{ id: string; cwd?: string }> {
  const text = await readArtifact(artifact, 1)
  const line = text.split('\n', 1)[0]
  if (line === undefined || line.length === 0) throw new Error(`empty session log: ${artifact.path}`)
  return parseHeader(line)
}

async function readSessionTitle(artifact: SessionArtifact): Promise<string | undefined> {
  const text = await readArtifact(artifact)
  let title: string | undefined
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"session/title"')) continue
    const value = JSON.parse(line) as unknown
    if (isSessionTitle(value)) {
      title = value.data.title.trim()
    }
  }
  return title
}

function isSessionTitle(value: unknown): value is { type: 'session/title'; data: { title: string } } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { type?: unknown; data?: unknown }
  if (record.type !== 'session/title' || typeof record.data !== 'object' || record.data === null) return false
  const data = record.data as { title?: unknown }
  return typeof data.title === 'string' && data.title.trim() !== ''
}

async function readArtifact(artifact: SessionArtifact, maxFrames = Number.POSITIVE_INFINITY): Promise<string> {
  const source = await readFile(artifact.path)
  if (!artifact.compressed) return source.toString('utf8')
  const frames = scanZstdFrames(source, maxFrames)
  if (frames.length === 0) throw new Error(`empty or incomplete Zstandard session log: ${artifact.path}`)
  return Buffer.concat(frames.map(({ start, end }) => zstdDecompressSync(source.subarray(start, end))))
    .toString('utf8')
}

/** Locate structurally complete independent Zstandard frames in an append log. */
export function scanZstdFrames(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): readonly { start: number; end: number }[] {
  const frames: { start: number; end: number }[] = []
  let offset = 0
  while (offset < buffer.length && frames.length < maxFrames) {
    const start = offset
    if (buffer.length - offset < 5) break
    if (buffer.readUInt32LE(offset) !== 0xFD2FB528) {
      throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
    }
    offset += 4
    const descriptor = buffer.readUInt8(offset++)
    if ((descriptor & 0x18) !== 0) throw new Error(`invalid Zstandard frame header at byte ${offset - 1}`)
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const contentSizeFlag = descriptor >>> 6
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeader = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeader) break
    offset += remainingHeader
    let complete = false
    for (;;) {
      if (buffer.length - offset < 3) break
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      if (blockType === 3) throw new Error(`invalid Zstandard block at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockHeader >>> 3
      if (buffer.length - offset < payloadBytes) break
      offset += payloadBytes
      if (!lastBlock) continue
      if (checksum) {
        if (buffer.length - offset < 4) break
        offset += 4
      }
      complete = true
      break
    }
    if (!complete) break
    frames.push({ start, end: offset })
  }
  return frames
}

function parseHeader(line: string): { id: string; cwd?: string } {
  const value = JSON.parse(line) as { type?: unknown; id?: unknown; cwd?: unknown }
  if (value.type !== 'session' || typeof value.id !== 'string') throw new Error('invalid session header')
  if (value.cwd !== undefined && typeof value.cwd !== 'string') throw new Error('invalid session workspace')
  return { id: value.id, ...(value.cwd === undefined ? {} : { cwd: value.cwd }) }
}

/** Match the readable project-directory convention used by dsh JSONL persistence. */
export function projectKey(workspace: string): string {
  if (workspace.length === 0) throw new Error('cannot encode an empty workspace path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < workspace.length; i++) {
    const code = workspace.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

function decodeProjectDirectory(value: string): string {
  if (value === '_no-cwd') return '(unknown workspace)'
  const inner = value.startsWith('--') && value.endsWith('--') ? value.slice(2, -2) : value
  return `/${decodeSegment(inner).replaceAll('-', '/')}`
}

function decodeSegment(value: string): string {
  return value.replace(/~([0-9A-F]{4})/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
