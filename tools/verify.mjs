// Checks the hard invariant through the API only: no event holds more guests than its limit.
// Run it after every write scenario (B1, I1, I2). Reads GET /events/{id} for each event in fixtures.json.
//
// It cannot see the seat counter table (event_seat_count): that check needs database access (make invariants).
import { call, describe, ok, out, readJson } from './lib/api.mjs';

const fixtures = readJson(out('fixtures.json'));
const tokens = readJson(out('tokens.json'));
const token = (tokens.find((t) => t.role === 'user') || tokens[0]).token;

const groups = [
  ['hot', fixtures.hot_event_ids || []],
  ['control', fixtures.control_event_ids || []],
  ['race', fixtures.race_event_ids || []],
  ['open', fixtures.open_event_id ? [fixtures.open_event_id] : []],
];

const pick = (json, key) => json?.[key] ?? json?.data?.[key];
const rows = [];
let oversold = 0;
let unknown = 0;

for (const [kind, ids] of groups) {
  for (const id of ids) {
    const res = await call('GET', `/events/${id}`, { token });
    if (!ok(res)) {
      rows.push({ kind, id, limit: '-', guests: '-', state: `request failed: ${describe(res)}` });
      unknown++;
      continue;
    }
    const limit = pick(res.json, 'limit');
    const guests = pick(res.json, 'members_count');
    if (typeof limit !== 'number' || typeof guests !== 'number') {
      rows.push({ kind, id, limit: '-', guests: '-', state: 'no limit or members_count in the response' });
      unknown++;
      continue;
    }
    const state = guests > limit ? 'OVERSOLD' : guests === limit ? 'full' : 'ok';
    if (state === 'OVERSOLD') oversold++;
    rows.push({ kind, id, limit, guests, state });
  }
}

console.log('kind     guests / limit   state      event');
for (const r of rows) console.log(`${String(r.kind).padEnd(8)} ${String(r.guests).padStart(6)} / ${String(r.limit).padEnd(6)}   ${String(r.state).padEnd(10)} ${r.id}`);

if (oversold > 0) {
  console.error(`\nFAIL: ${oversold} event(s) hold more guests than their limit.`);
  process.exit(1);
}
if (unknown > 0) {
  console.error(`\nUNKNOWN: ${unknown} event(s) could not be read, so the invariant is not proven.`);
  process.exit(2);
}
console.log('\nOK: no event is oversold.');
