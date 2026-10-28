/**
 * Tolerate additive Coach Hub fields while a project is awaiting its SQL migration.
 * Required identifiers, stats, permissions and unrelated failures MUST NOT be ignored.
 * The complete team snapshot is still uploaded separately by Full Sync.
 */
const OPTIONAL_COLUMNS = {
  teams: ['team_type'],
  matches: ['event_name', 'event_round']
};

export function missingOptionalColumn(error, table, payload) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  if (!['PGRST204', '42703'].includes(code) &&
      !/could not find .* column .* schema cache|column .* does not exist/i.test(message)) return null;
  const options = OPTIONAL_COLUMNS[table] || [];
  const columns = Array.isArray(payload) ? payload[0] : payload;
  if (!columns || typeof columns !== 'object') return null;

  // PostgREST schema cache, PostgreSQL INSERT, and PostgreSQL qualified SELECT.
  const schemaCache = message.match(/could not find the ['"]?([a-z_][\w]*)['"]? column of ['"]?([a-z_][\w]*)['"]? in the schema cache/i);
  const insert = message.match(/column ['"]?([a-z_][\w]*)['"]? of relation ['"]?([a-z_][\w]*)['"]? does not exist/i);
  const qualified = message.match(/column (?:(['"]?)([a-z_][\w]*)\1\.)?['"]?([a-z_][\w]*)['"]? does not exist/i);

  const missing = schemaCache?.[1] || insert?.[1] || qualified?.[3];
  const errorTable = schemaCache?.[2] || insert?.[2] || qualified?.[2] || table;
  return errorTable === table && options.includes(missing) &&
    Object.prototype.hasOwnProperty.call(columns, missing) ? missing : null;
}

/**
 * Retry a write only if PostgREST rejects a known, nonessential new column.
 * Never mutate the original objects. All other errors, including RLS, propagate.
 */
export async function writeWithSchemaFallback(table, payload, write, onSkipped = () => {}) {
  let current = Array.isArray(payload) ? payload.map(row => ({...row})) : {...payload};
  const skipped = [];
  for (;;) {
    const result = await write(current);
    if (!result?.error) {
      if (skipped.length) onSkipped(skipped);
      return result;
    }
    const missing = missingOptionalColumn(result.error, table, current);
    if (!missing || skipped.includes(missing)) throw result.error;
    skipped.push(missing);
    if (Array.isArray(current)) current = current.map(row => {
      const next = {...row};
      delete next[missing];
      return next;
    });
    else {
      const next = {...current};
      delete next[missing];
      current = next;
    }
  }
}
