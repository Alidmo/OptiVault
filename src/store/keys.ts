// Shared graph-key utilities.
//
// A "graph key" is the canonical identifier used in the SQLite store for a
// file node: forward-slashed relative path with the source extension
// stripped. Both the indexer (init / sync) and the readers (query_graph)
// must agree on this normalization so lookups join cleanly.

const SOURCE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|php|c|cpp|cc|cxx|h|hpp|hxx|cs|swift)$/i;

export function normalizeGraphKey(key: string): string {
  let k = key.replace(/\\/g, '/').trim();
  k = k.replace(SOURCE_EXT_RE, '');
  return k;
}
