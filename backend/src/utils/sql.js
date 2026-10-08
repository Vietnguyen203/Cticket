/**
 * Build the SET part of a PATCH-style UPDATE from the keys that are present.
 *
 *   buildSetClause({ name: 'A', description: null }, { name: 'name', description: 'description' }, 2)
 *   → { clause: 'name = $2, description = $3', params: ['A', null] }
 *
 * - `undefined` means "not sent, leave unchanged"; `null` means "clear it".
 * - Column names come only from the fixed `columns` map, never from request
 *   keys, so a client cannot inject SQL through a field name.
 *
 * @param {Record<string, unknown>} changes
 * @param {Record<string, string>} columns  request key → column name
 * @param {number} firstParamIndex  number of the first placeholder to use
 */
function buildSetClause(changes, columns, firstParamIndex) {
  const assignments = [];
  const params = [];
  for (const [key, column] of Object.entries(columns)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      assignments.push(`${column} = $${firstParamIndex + params.length - 1}`);
    }
  }
  return { clause: assignments.join(', '), params };
}

module.exports = { buildSetClause };
