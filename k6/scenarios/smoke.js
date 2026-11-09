// One pass over every read the other scenarios use. Run it first, on a freshly seeded environment.
// It checks that the target, the tokens, and the fixtures are right before any load is sent.
import { check } from 'k6';
import { get } from '../lib/http.js';
import { need, pick } from '../lib/fixtures.js';
import { randomToken, tokenOfUser } from '../lib/auth.js';
import { thresholds } from '../lib/thresholds.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: thresholds(['read_public', 'read_hot', 'read_login', 'search', 'dashboard']),
};

export default function () {
  const hot = need('hot_event_id');
  const token = randomToken();
  const host = tokenOfUser(need('pass_host_id'));

  const calls = [
    ['public list', get('/public/events?limit=5', { kind: 'read_public' })],
    ['public detail', get(`/public/events/${hot}`, { kind: 'read_hot' })],
    ['public members', get(`/public/events/${hot}/members?limit=5`, { kind: 'read_hot' })],
    ['signed-in list', get('/events?limit=5', { kind: 'read_login', token })],
    ['timeline', get('/timeline?limit=5', { kind: 'read_login', token })],
    ['for you', get('/v2/search/for-you', { kind: 'read_login', token })],
    ['trending', get('/v2/search/trending', { kind: 'read_login', token })],
    ['search', get('/v2/search/activities?q=stress', { kind: 'search', expected: [429] })],
    ['profile', get(`/users/${pick(need('user_ids'))}`, { kind: 'read_login', token })],
    ['pass holders', get('/analytics/passes/participants?limit=5', { kind: 'dashboard', token: host })],
    ['pass holder count', get('/analytics/passes/participants/count', { kind: 'dashboard', token: host })],
  ];

  for (const [name, res] of calls) {
    const ok = check(res, { [`${name}: 200`]: (r) => r.status === 200 });
    if (!ok) console.error(`${name}: status ${res.status} ${String(res.body).slice(0, 160)}`);
  }

  // Shape of the pass holder response, so passHolderPages() can follow the cursor.
  const holders = calls.find(([name]) => name === 'pass holders')[1];
  if (holders.status === 200) {
    const body = holders.json();
    const list = Array.isArray(body) ? body : body.data || body.items || body.participants;
    check(list, { 'pass holders: list found in the response': (l) => Array.isArray(l) && l.length > 0 && !!l[0].id });
  }
}
