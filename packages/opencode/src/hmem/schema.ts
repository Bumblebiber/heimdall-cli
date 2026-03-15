export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS memories (
    id            TEXT PRIMARY KEY,
    prefix        TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    level_1       TEXT NOT NULL,
    level_2       TEXT,
    level_3       TEXT,
    level_4       TEXT,
    level_5       TEXT,
    access_count  INTEGER DEFAULT 0,
    last_accessed TEXT,
    links         TEXT,
    min_role      TEXT DEFAULT 'worker',
    obsolete      INTEGER DEFAULT 0,
    favorite      INTEGER DEFAULT 0,
    irrelevant    INTEGER DEFAULT 0,
    title         TEXT,
    pinned        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prefix ON memories(prefix);
CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_access ON memories(access_count);
CREATE INDEX IF NOT EXISTS idx_role ON memories(min_role);

CREATE TABLE IF NOT EXISTS memory_nodes (
    id            TEXT PRIMARY KEY,
    parent_id     TEXT NOT NULL,
    root_id       TEXT NOT NULL,
    depth         INTEGER NOT NULL,
    seq           INTEGER NOT NULL,
    content       TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    access_count  INTEGER DEFAULT 0,
    last_accessed TEXT,
    title         TEXT,
    favorite      INTEGER DEFAULT 0,
    irrelevant    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON memory_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_root   ON memory_nodes(root_id);

CREATE TABLE IF NOT EXISTS schema_version (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS hmem_fts USING fts5(
    level_1,
    node_content,
    content='',
    tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS hmem_fts_rowid_map (
    fts_rowid INTEGER PRIMARY KEY,
    root_id   TEXT NOT NULL,
    node_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_fts_rm_root ON hmem_fts_rowid_map(root_id);
CREATE INDEX IF NOT EXISTS idx_fts_rm_node ON hmem_fts_rowid_map(node_id);

CREATE TRIGGER IF NOT EXISTS hmem_fts_mem_ai
AFTER INSERT ON memories WHEN new.seq > 0
BEGIN
    INSERT INTO hmem_fts(level_1, node_content) VALUES (coalesce(new.level_1,''),'');
    INSERT INTO hmem_fts_rowid_map(fts_rowid, root_id, node_id)
        VALUES (last_insert_rowid(), new.id, NULL);
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_node_ai
AFTER INSERT ON memory_nodes
BEGIN
    INSERT INTO hmem_fts(level_1, node_content) VALUES ('', coalesce(new.content,''));
    INSERT INTO hmem_fts_rowid_map(fts_rowid, root_id, node_id)
        VALUES (last_insert_rowid(), new.root_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_mem_au
AFTER UPDATE OF level_1 ON memories WHEN new.seq > 0
BEGIN
    INSERT INTO hmem_fts(hmem_fts, rowid, level_1, node_content)
        VALUES ('delete', (SELECT fts_rowid FROM hmem_fts_rowid_map WHERE root_id=old.id AND node_id IS NULL), old.level_1,'');
    INSERT INTO hmem_fts(level_1, node_content) VALUES (coalesce(new.level_1,''),'');
    UPDATE hmem_fts_rowid_map SET fts_rowid=last_insert_rowid()
        WHERE root_id=new.id AND node_id IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_mem_bd
BEFORE DELETE ON memories
BEGIN
    INSERT INTO hmem_fts(hmem_fts, rowid, level_1, node_content)
        VALUES ('delete', (SELECT fts_rowid FROM hmem_fts_rowid_map WHERE root_id=old.id AND node_id IS NULL), old.level_1,'');
    DELETE FROM hmem_fts_rowid_map WHERE root_id=old.id;
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_node_bd
BEFORE DELETE ON memory_nodes
BEGIN
    INSERT INTO hmem_fts(hmem_fts, rowid, level_1, node_content)
        VALUES ('delete', (SELECT fts_rowid FROM hmem_fts_rowid_map WHERE node_id=old.id),'', old.content);
    DELETE FROM hmem_fts_rowid_map WHERE node_id=old.id;
END;

CREATE TABLE IF NOT EXISTS memory_tags (
    entry_id TEXT NOT NULL,
    tag      TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag);
`

export const MIGRATIONS: string[] = [
  "ALTER TABLE memories ADD COLUMN min_role TEXT DEFAULT 'worker'",
  "ALTER TABLE memories ADD COLUMN obsolete INTEGER DEFAULT 0",
  "ALTER TABLE memories ADD COLUMN favorite INTEGER DEFAULT 0",
  "ALTER TABLE memories ADD COLUMN title TEXT",
  "ALTER TABLE memory_nodes ADD COLUMN title TEXT",
  "ALTER TABLE memories ADD COLUMN irrelevant INTEGER DEFAULT 0",
  "ALTER TABLE memory_nodes ADD COLUMN favorite INTEGER DEFAULT 0",
  "ALTER TABLE memory_nodes ADD COLUMN irrelevant INTEGER DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS memory_tags (entry_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (entry_id, tag))",
  "CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag)",
  "ALTER TABLE memories ADD COLUMN pinned INTEGER DEFAULT 0",
  "ALTER TABLE memories ADD COLUMN updated_at TEXT",
  "ALTER TABLE memory_nodes ADD COLUMN updated_at TEXT",
]
