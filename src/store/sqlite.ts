// OptiVault SQLite store
//
// Persists the AST graph in `<vault>/graph.sqlite`:
//   nodes  — files + granular entities (functions / classes / routes)
//   edges  — typed relations: DEPENDS_ON | CALLS | EXTENDS
//
// Queries from `query_graph` (and any other MCP tool that needs to traverse
// the graph) execute directly against this store rather than re-parsing
// markdown wikilinks.

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeKind = 'file' | 'function' | 'class' | 'route';
export type EdgeKind = 'DEPENDS_ON' | 'CALLS' | 'EXTENDS';

export interface GraphNode {
  /** Stable identifier — for files: normalized graph key (no extension);
   *  for entities: `<file>::<name>`. */
  id: string;
  kind: NodeKind;
  file: string;
  name: string | null;
  roles: string[];
  purpose: string | null;
  isEntryPoint: boolean;
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: EdgeKind;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  file            TEXT NOT NULL,
  name            TEXT,
  roles           TEXT NOT NULL DEFAULT '[]',
  purpose         TEXT,
  is_entry_point  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);

CREATE TABLE IF NOT EXISTS edges (
  src   TEXT NOT NULL,
  dst   TEXT NOT NULL,
  kind  TEXT NOT NULL,
  PRIMARY KEY (src, dst, kind)
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src, kind);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst, kind);
`;

// ---------------------------------------------------------------------------
// GraphStore
// ---------------------------------------------------------------------------

export class GraphStore {
  private db: DB;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  upsertNode(node: GraphNode): void {
    this.db
      .prepare(
        `INSERT INTO nodes (id, kind, file, name, roles, purpose, is_entry_point)
         VALUES (@id, @kind, @file, @name, @roles, @purpose, @isEntryPoint)
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind,
           file=excluded.file,
           name=excluded.name,
           roles=excluded.roles,
           purpose=excluded.purpose,
           is_entry_point=excluded.is_entry_point`
      )
      .run({
        id: node.id,
        kind: node.kind,
        file: node.file,
        name: node.name,
        roles: JSON.stringify(node.roles ?? []),
        purpose: node.purpose,
        isEntryPoint: node.isEntryPoint ? 1 : 0,
      });
  }

  upsertEdge(edge: GraphEdge): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO edges (src, dst, kind) VALUES (?, ?, ?)`
      )
      .run(edge.src, edge.dst, edge.kind);
  }

  /** Replace all edges that originate from `src` with the supplied list.
   *  Used during re-parse to keep edges in sync with the latest source. */
  replaceOutgoingEdges(src: string, edges: GraphEdge[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM edges WHERE src = ?`).run(src);
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO edges (src, dst, kind) VALUES (?, ?, ?)`
      );
      for (const e of edges) {
        stmt.run(e.src, e.dst, e.kind);
      }
    });
    tx();
  }

  /** Drop a file and every entity / edge that belongs to it. */
  deleteFile(fileKey: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM edges WHERE src = ? OR dst = ?`)
        .run(fileKey, fileKey);
      this.db.prepare(`DELETE FROM nodes WHERE file = ?`).run(fileKey);
    });
    tx();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  hasNode(id: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM nodes WHERE id = ? LIMIT 1`)
      .get(id);
    return row !== undefined;
  }

  getNode(id: string): GraphNode | null {
    const row = this.db
      .prepare(`SELECT * FROM nodes WHERE id = ?`)
      .get(id) as RawNodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  /** Return direct neighbors of `id` along `direction`:
   *   - 'out' = src=id  (e.g. dependencies / outgoing CALLS)
   *   - 'in'  = dst=id  (e.g. callers / incoming references) */
  neighbors(
    id: string,
    direction: 'out' | 'in',
    kinds?: EdgeKind[]
  ): Array<{ id: string; kind: EdgeKind }> {
    const col = direction === 'out' ? 'dst' : 'src';
    const matchCol = direction === 'out' ? 'src' : 'dst';
    if (kinds && kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT ${col} AS id, kind FROM edges WHERE ${matchCol} = ? AND kind IN (${placeholders})`
        )
        .all(id, ...kinds) as Array<{ id: string; kind: EdgeKind }>;
      return rows;
    }
    const rows = this.db
      .prepare(`SELECT ${col} AS id, kind FROM edges WHERE ${matchCol} = ?`)
      .all(id) as Array<{ id: string; kind: EdgeKind }>;
    return rows;
  }

  /** BFS traversal up to `depth`. Nodes are reported at first-seen depth. */
  traverse(
    from: string,
    direction: 'out' | 'in',
    depth: number,
    kinds?: EdgeKind[]
  ): Array<{ file: string; depth: number }> {
    const cappedDepth = Math.max(1, Math.min(depth, 10));
    const seen = new Set<string>([from]);
    let frontier: string[] = [from];
    const results: Array<{ file: string; depth: number }> = [];

    for (let d = 1; d <= cappedDepth; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const nb of this.neighbors(node, direction, kinds)) {
          if (seen.has(nb.id)) continue;
          seen.add(nb.id);
          results.push({ file: nb.id, depth: d });
          next.push(nb.id);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return results;
  }

  /** Fetch every file-node whose `roles` JSON array includes `role`. */
  queryByRole(role: string): GraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE kind = 'file'
           AND EXISTS (
             SELECT 1 FROM json_each(nodes.roles) WHERE value = ?
           )`
      )
      .all(role) as RawNodeRow[];
    return rows.map(rowToNode);
  }

  /** All file nodes — used for repo-map summary generation. */
  allFiles(): GraphNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE kind = 'file' ORDER BY id`)
      .all() as RawNodeRow[];
    return rows.map(rowToNode);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawNodeRow {
  id: string;
  kind: NodeKind;
  file: string;
  name: string | null;
  roles: string;
  purpose: string | null;
  is_entry_point: number;
}

function rowToNode(row: RawNodeRow): GraphNode {
  let roles: string[] = [];
  try {
    const parsed = JSON.parse(row.roles);
    if (Array.isArray(parsed)) roles = parsed.filter((r) => typeof r === 'string');
  } catch {
    roles = [];
  }
  return {
    id: row.id,
    kind: row.kind,
    file: row.file,
    name: row.name,
    roles,
    purpose: row.purpose,
    isEntryPoint: row.is_entry_point === 1,
  };
}

/** Open or create the graph store at `<vaultDir>/graph.sqlite`. */
export function openGraphStore(vaultDir: string): GraphStore {
  return new GraphStore(`${vaultDir}/graph.sqlite`);
}
