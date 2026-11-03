import type { DatabaseSync } from 'node:sqlite';

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

/**
 * Lightweight, additive migrations for the single-file SQLite metadata store.
 * Vector payloads live in the vector store and are always rebuildable.
 */
export function applyMigrations(db: DatabaseSync): void {
  if (!hasColumn(db, 'documents', 'chunk_count')) {
    db.exec('ALTER TABLE documents ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'documents', 'index_error')) {
    db.exec("ALTER TABLE documents ADD COLUMN index_error TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'documents', 'checksum')) {
    db.exec("ALTER TABLE documents ADD COLUMN checksum TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'documents', 'updated_at')) {
    db.exec("ALTER TABLE documents ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'messages', 'citations')) {
    db.exec("ALTER TABLE messages ADD COLUMN citations TEXT NOT NULL DEFAULT '[]'");
  }

  db.exec("UPDATE documents SET updated_at = created_at WHERE updated_at = ''");

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  insertSetting.run('embedding_backend', 'local');
  insertSetting.run('embedding_provider_id', '');
  insertSetting.run('embedding_model', 'astra-hash-1536');
  insertSetting.run('embedding_dimensions', '1536');
  insertSetting.run('rag_top_k', '5');
  insertSetting.run('rag_min_score', '0.12');
}
