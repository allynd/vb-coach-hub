/**
 * Merge a cloud team backup into IndexedDB data without erasing offline edits.
 * On first refresh, overlapping local records are left intact. Later refreshes
 * may update/delete a record only if it still matches the last cloud copy seen.
 */
function comparable(record, collection) {
  const copy = {...record};
  if (collection === 'players') delete copy.photo;
  return JSON.stringify(copy);
}

export function mergeTeamCloudSnapshot(state, teamId, remote) {
  const summary = {addedPlayers:0, addedMatches:0, addedStats:0, updated:0, removed:0, conflicts:0};
  const bases = state.teamCloudBaselines || (state.teamCloudBaselines = {});
  const prior = bases[teamId] || {};
  const next = {};
  const knownMatches = new Set([
    ...(state.games || []).filter(g => g.teamId === teamId).map(g => g.id),
    ...(remote.games || []).filter(g => g.teamId === teamId).map(g => g.id)
  ]);

  function mergeCollection(collection, incoming, belongsToTeam, addedKey) {
    const existing = Array.isArray(state[collection]) ? state[collection] : [];
    const previous = prior[collection] || {};
    const fingerprints = {};
    const indexes = new Map(existing.map((item, index) => [item.id, index]));
    const ignored = new Set();
    const currentCloudIds = new Set();
    for (const row of incoming || []) {
      if (!row || !row.id || !belongsToTeam(row) || currentCloudIds.has(row.id)) continue;
      currentCloudIds.add(row.id);
      const fresh = comparable(row, collection);
      fingerprints[row.id] = fresh;
      const index = indexes.get(row.id);
      if (index === undefined) {
        existing.push(row);
        indexes.set(row.id, existing.length-1);
        summary[addedKey]++;
        continue;
      }
      const current = existing[index];
      const local = comparable(current, collection);
      if (local === fresh) continue;
      if (Object.hasOwn(previous, row.id) && local === previous[row.id]) {
        // Don't clear images just because snapshots omit base64 media.
        existing[index] = collection === 'players'
          ? {...row, photo:current.photo || row.photo || ''}
          : row;
        summary.updated++;
      } else {
        // The device may have unsynced corrections; never overwrite these.
        summary.conflicts++;
      }
    }
    for (const [id, fingerprint] of Object.entries(previous)) {
      if (currentCloudIds.has(id)) continue;
      const index = indexes.get(id);
      if (index === undefined) continue;
      if (comparable(existing[index], collection) === fingerprint) {
        ignored.add(id);
        summary.removed++;
      } else {
        summary.conflicts++;
      }
    }
    state[collection] = existing.filter(item => !ignored.has(item.id));
    next[collection] = fingerprints;
  }

  mergeCollection('players', remote.players, p => p.teamId === teamId, 'addedPlayers');
  mergeCollection('games', remote.games, g => g.teamId === teamId, 'addedMatches');
  mergeCollection('events', remote.events,
    e => e.teamId === teamId || (e.gameId && knownMatches.has(e.gameId)), 'addedStats');
  bases[teamId] = next;
  return summary;
}
