// Prepares a stress run through the API only, with the accounts you chose in accounts.csv.
//
//   node tools/setup.mjs                 tokens + events + guests -> tokens.json, fixtures.json
//   node tools/setup.mjs --tokens-only   only the tokens: access tokens last 30 minutes, so run it before every run
//
// accounts.csv columns: email, role, refresh_token (or access_token)
//   role "host"      creates the events
//   role "passhost"  a host whose pass holders are paged by D1; it also creates events
//   role "user"      joins the events, and is the account the scenarios act as
//
// Everything it creates is recorded in state/created.json, which "make teardown" uses to cancel exactly those events.
// Event titles are letters and short numbers only: the API refuses a title or description with 8 or more digits in a row.
import fs from 'node:fs';
import { BASE, call, claims, DEVICE, describe, mapLimit, ok, out, readCsv, RUN_ID, writeJson } from './lib/api.mjs';

const ACCOUNTS = process.env.ACCOUNTS_FILE || out('accounts.csv');
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const COUNTS = {
  hot: Number(process.env.HOT ?? 1),
  control: Number(process.env.CONTROL ?? 10),
  race: Number(process.env.RACE ?? 20),
  open: Number(process.env.OPEN ?? 1),
  fill: Number(process.env.FILL ?? 20),
};
const HOT_GUESTS = process.env.HOT_GUESTS ? Number(process.env.HOT_GUESTS) : Infinity;
const tokensOnly = process.argv.includes('--tokens-only');

// ---- 1. Tokens ----------------------------------------------------------------------------------

const accounts = readCsv(ACCOUNTS).filter((a) => a.email);
if (accounts.length === 0) throw new Error(`${ACCOUNTS} has no accounts`);

const problems = [];
await mapLimit(accounts, CONCURRENCY, async (account) => {
  if (account.refresh_token) {
    const res = await call('POST', '/auth/refresh', { body: { refresh_token: account.refresh_token, ...DEVICE } });
    if (!ok(res) || !res.json?.access_token) return problems.push(`${account.email}: refresh failed: ${describe(res)}`);
    account.token = res.json.access_token;
  } else if (account.access_token) {
    account.token = account.access_token;
  } else {
    return problems.push(`${account.email}: no refresh_token or access_token. Run "make login".`);
  }
  const payload = claims(account.token);
  account.id = payload.sub;
  account.exp = payload.exp;
});

if (problems.length > 0) {
  console.error(problems.slice(0, 20).join('\n'));
  console.error(`${problems.length} of ${accounts.length} accounts have no usable token.`);
  process.exit(1);
}

const roleOf = (a) => (a.role || 'user').toLowerCase();
writeJson(
  out('tokens.json'),
  accounts.map((a) => ({ id: a.id, email: a.email, role: roleOf(a), token: a.token, exp: a.exp })),
  0o600,
);
const minutes = Math.floor((Math.min(...accounts.map((a) => a.exp)) * 1000 - Date.now()) / 60000);
console.log(`${out('tokens.json')}: ${accounts.length} tokens, the first one expires in ${minutes} minutes.`);
if (tokensOnly) process.exit(0);

// ---- 2. Events ----------------------------------------------------------------------------------

const hosts = accounts.filter((a) => ['host', 'passhost'].includes(roleOf(a)));
const users = accounts.filter((a) => roleOf(a) === 'user');
if (hosts.length === 0) throw new Error('accounts.csv needs at least one account with role host');
if (users.length === 0) throw new Error('accounts.csv needs at least one account with role user');

const hotGuests = Math.min(users.length, HOT_GUESTS);
const plan = [];
const add = (kind, count, limit) => {
  for (let n = 1; n <= count; n++) plan.push({ kind, name: `Stress ${kind[0].toUpperCase()}${kind.slice(1)} ${n}`, limit });
};
add('hot', COUNTS.hot, Math.max(hotGuests + 50, 200));
add('control', COUNTS.control, 30);
add('race', COUNTS.race, 50);
add('open', COUNTS.open, 200);
add('fill', COUNTS.fill, 30);

function eventBody({ name, limit }, index) {
  const start = new Date(Date.now() + (48 + (index % 48)) * 3600e3);
  const end = new Date(start.getTime() + 2 * 3600e3);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    name,
    description: 'Stress test activity. Safe to cancel.',
    category: 'sports',
    type: 'public',
    start_timestamp: iso(start),
    end_timestamp: iso(end),
    price: 0,
    limit,
    location: 'Jakarta',
  };
}

fs.mkdirSync(out('state'), { recursive: true });
const recordFile = out('state/created.json');
const recorded = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : [];
const created = [];
const failures = [];

await mapLimit(plan, 5, async (item, index) => {
  const host = hosts[index % hosts.length];
  const res = await call('POST', '/events', { token: host.token, body: eventBody(item, index) });
  if (!ok(res) || !res.json?.id) return failures.push(`${item.name}: create failed: ${describe(res)}`);
  const entry = { id: res.json.id, kind: item.kind, name: item.name, limit: item.limit, host_email: host.email, run_id: RUN_ID, created_at: new Date().toISOString() };
  created.push(entry);
  recorded.push(entry);
});
writeJson(recordFile, recorded); // written before the guests join, so a crash below still leaves a record to tear down
if (failures.length > 0) console.error(failures.slice(0, 10).join('\n'));

const ofKind = (kind) => created.filter((e) => e.kind === kind);

// ---- 3. Guests ----------------------------------------------------------------------------------

const answers = (account, n) => [
  { order: 0, template_name: 'name', answer: `Stress User ${n}` },
  { order: 1, template_name: 'form_email', answer: account.email },
  { order: 2, template_name: 'phone', answer: '081200000000' },
];
const tally = {};
async function join(event, account, n) {
  const res = await call('POST', `/events/${event.id}/join`, { token: account.token, body: { quantity: 1, answers: answers(account, n) } });
  const key = ok(res) ? 'joined' : `status_${res.status}`;
  tally[event.name] = tally[event.name] || {};
  tally[event.name][key] = (tally[event.name][key] || 0) + 1;
  return res;
}

// The hot event gets one guest per user account, so its size is the number of accounts you gave. The API cannot
// write rows directly: 2,500 guests need 2,500 accounts.
for (const event of ofKind('hot')) await mapLimit(users.slice(0, hotGuests), CONCURRENCY, (user, i) => join(event, user, i + 1));
for (const event of ofKind('control')) {
  await mapLimit(users.slice(0, 10), CONCURRENCY, (user, i) => join(event, user, i + 1));
}

// ---- 4. Fixtures --------------------------------------------------------------------------------

const passhost = accounts.find((a) => roleOf(a) === 'passhost') || hosts[0];
const fixtures = {
  run_id: RUN_ID,
  base_url: BASE,
  hot_event_id: ofKind('hot')[0]?.id ?? null,
  hot_event_ids: ofKind('hot').map((e) => e.id),
  control_event_ids: ofKind('control').map((e) => e.id),
  race_event_ids: ofKind('race').map((e) => e.id),
  open_event_id: ofKind('open')[0]?.id ?? null,
  fill_event_ids: ofKind('fill').map((e) => e.id),
  pass_host_id: passhost.id,
  user_ids: users.slice(0, 200).map((u) => u.id),
  // Accounts without a username cannot be told apart through the API. See the README (KUYY-70).
  user_ids_without_username: [],
};
writeJson(out('fixtures.json'), fixtures);

console.log(`\nEvents created: ${created.length} of ${plan.length}`);
for (const kind of Object.keys(COUNTS)) console.log(`  ${kind.padEnd(8)} ${ofKind(kind).length}`);
console.log('Joins by event (only the events that took guests):');
for (const [name, counts] of Object.entries(tally)) console.log(`  ${name.padEnd(18)} ${JSON.stringify(counts)}`);
console.log(`\n${out('fixtures.json')} written. Record of what was created: ${recordFile}`);
process.exit(failures.length > 0 ? 1 : 0);
