// Cancels the events that "make setup" created, as their host, through the API. It reads state/created.json,
// so it touches exactly those events and nothing else, also from earlier runs.
//
//   node tools/teardown.mjs
//
// Guests of a free event are not charged, so the cancel is sent with no_refund. Entries that were cancelled leave the
// record; entries that failed stay, and a second run retries them.
import fs from 'node:fs';
import { call, describe, mapLimit, ok, out, readJson, writeJson } from './lib/api.mjs';

const recordFile = out('state/created.json');
if (!fs.existsSync(recordFile)) {
  console.log(`Nothing to tear down: ${recordFile} does not exist.`);
  process.exit(0);
}

const recorded = readJson(recordFile);
const tokens = readJson(out('tokens.json'));
const byEmail = Object.fromEntries(tokens.map((t) => [t.email, t]));
const now = Date.now() / 1000;

const left = [];
let cancelled = 0;
await mapLimit(recorded, 5, async (entry) => {
  const host = byEmail[entry.host_email];
  if (!host || host.exp < now) {
    left.push(entry);
    console.error(`${entry.name}: the token of ${entry.host_email} is missing or expired. Run "make tokens" first.`);
    return;
  }
  const res = await call('POST', `/events/${entry.id}/cancel`, { token: host.token, body: { no_refund: true } });
  if (ok(res)) {
    cancelled++;
  } else {
    left.push(entry);
    console.error(`${entry.name} (${entry.id}): cancel failed: ${describe(res)}`);
  }
});

writeJson(recordFile, left);
console.log(`Cancelled ${cancelled} event(s). ${left.length} left in ${recordFile}.`);
process.exit(left.length === 0 ? 0 : 1);
