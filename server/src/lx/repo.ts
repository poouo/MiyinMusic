import { getDb, p, transaction } from '../db.js'
import type { PersistedSource } from './manager.js'

interface SourceRow {
  id: string
  kind: string
  name: string
  url: string | null
  script: string | null
  enabled: number
  position: number
}

export function listSources(): PersistedSource[] {
  const rows = getDb()
    .prepare('SELECT id, kind, name, url, script, enabled, position FROM sources ORDER BY position ASC')
    .all() as unknown as SourceRow[]
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind === 'custom' ? 'custom' : 'builtin',
    name: row.name,
    url: row.url ?? undefined,
    script: row.script ?? undefined,
    enabled: Number(row.enabled) === 1,
    order: Number(row.position),
  }))
}

export function saveSources(sources: PersistedSource[]): void {
  transaction((db) => {
    db.prepare('DELETE FROM sources').run()
    const insert = db.prepare(
      'INSERT INTO sources (id, kind, name, url, script, enabled, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const now = Date.now()
    sources.forEach((source, index) => {
      insert.run(
        source.id,
        source.kind,
        source.name,
        p(source.url),
        p(source.script),
        source.enabled ? 1 : 0,
        source.order ?? index,
        now,
      )
    })
  })
}
