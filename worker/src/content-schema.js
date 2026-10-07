// The public names match rowsToObjects_ (including the production-only markdown URLs).
// List cells are JSON values, so a legacy string, [] and an empty cell remain distinct.
export const CONTENT_TABLES = {
  posts: { table: 'posts', key: 'id', extra: true, columns: [
    'id', 'slug', 'title', 'excerpt', 'body', 'tags', 'status', 'createdAt',
    'updatedAt', 'publishedAt', 'source', 'storagePath', 'bodyUrl', 'syncStatus',
    'markdownBaseUrl', 'markdownRootUrl'
  ] },
  postDeletions: { table: 'post_deletions', key: 'id', columns: [
    'id', 'storagePath', 'nonce', 'deletedAt', 'finalizedAt'
  ] },
  guestbook: { table: 'guestbook_entries', key: 'id', columns: [
    'id', 'name', 'message', 'status', 'createdAt', 'passwordSalt', 'passwordHash',
    'passwordHashAlgorithm', 'passwordHashIterations', 'hiddenReason'
  ] },
  things: { table: 'things', key: 'id', extra: true, columns: [
    'id', 'title', 'description', 'url', 'imageUrl', 'status', 'sortOrder', 'updatedAt'
  ] },
  assetOverrides: { table: 'asset_overrides', key: 'assetId', extra: true, columns: [
    'assetId', 'displayName', 'description', 'tags', 'sourceUrl', 'status', 'sortOrder', 'updatedAt'
  ] },
  auditLog: { table: 'audit_log', key: 'id', columns: [
    'id', 'action', 'targetType', 'targetId', 'createdAt'
  ] }
};

export function parseCell(value) {
  if (typeof value !== 'string' || !/^[\[{]/.test(value.trim())) return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function storedRecord(definition, record) {
  const columns = [...definition.columns];
  const values = columns.map((column) => {
    const value = record[column] ?? '';
    if (column === 'tags') return JSON.stringify(parseCell(value));
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return Number(value);
    return value;
  });
  if (definition.extra) {
    columns.push('extra');
    values.push(JSON.stringify(Object.fromEntries(Object.entries(record)
      .filter(([key]) => !definition.columns.includes(key)))));
  }
  return { columns, values };
}

export function readRecord(definition, row) {
  const extra = definition.extra ? JSON.parse(row.extra) : {};
  return Object.assign(Object.fromEntries(definition.columns.map((key) => [
    key, key === 'tags' ? JSON.parse(row[key]) : parseCell(row[key])
  ])), extra);
}
