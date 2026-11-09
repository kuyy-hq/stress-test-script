// One function per user action. Scenarios combine them, so the mixed test (I1) and the single tests use the same requests.
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { get, post } from './http.js';
import { fixtures, need, pick } from './fixtures.js';
import { randomToken, tokenAt } from './auth.js';
import { WEB } from './config.js';

export const joinOk = new Counter('join_ok');
export const joinRefused = new Counter('join_refused'); // 422: event full or another business rule. Not a failure.
export const joinOther = new Counter('join_other'); // any other status that is not 2xx, 422, 429, 403 or 5xx

const WORDS = ['yoga', 'run', 'stress', 'event', 'pilates', 'zumba'];
const SEARCHES = ['yo', 'stress ev', 'ru', 'a', 'zzzz', 'PILATES'];

// ---- Reads -------------------------------------------------------------------------------------

export function publicList() {
  const search = Math.random() < 0.2 ? `&search=${pick(WORDS)}` : '';
  get(`/public/events?limit=20${search}`, { kind: 'read_public', name: '/public/events' });
}

export function hotEventDetail() {
  const id = need('hot_event_id');
  get(`/public/events/${id}`, { kind: 'read_hot', name: '/public/events/{id} (hot)' });
}

export function hotEventMembers() {
  const id = need('hot_event_id');
  get(`/public/events/${id}/members?limit=20`, { kind: 'read_hot', name: '/public/events/{id}/members (hot)' });
}

export function hotEventDetailSignedIn() {
  const id = need('hot_event_id');
  get(`/events/${id}`, { kind: 'read_hot', name: '/events/{id} (hot)', token: randomToken() });
}

// The comparison point of the hot event: same request, an event with 10 guests.
export function controlEventDetail() {
  const id = pick(need('control_event_ids'));
  get(`/public/events/${id}`, { kind: 'read_control', name: '/public/events/{id} (control)' });
}

export function feedEvents() {
  get('/events?limit=20', { kind: 'read_login', name: '/events', token: randomToken() });
}

export function feedTimeline() {
  get('/timeline?limit=20', { kind: 'read_login', name: '/timeline', token: randomToken() });
}

export function feedForYou() {
  get('/v2/search/for-you', { kind: 'read_login', name: '/v2/search/for-you', token: randomToken() });
}

export function feedTrending() {
  get('/v2/search/trending', { kind: 'read_login', name: '/v2/search/trending', token: randomToken() });
}

export function searchActivities(anonymous = false) {
  const q = encodeURIComponent(pick(SEARCHES));
  get(`/v2/search/activities?q=${q}`, { kind: 'search', name: '/v2/search/activities', expected: [429], token: !anonymous && Math.random() < 0.5 ? randomToken() : undefined });
}

export function profile() {
  const id = pick(need('user_ids'));
  get(`/users/${id}`, { kind: 'read_login', name: '/users/{id}', token: randomToken() });
}

// ---- Booking -----------------------------------------------------------------------------------

// Answers to the three questions every event gets (template names name, form_email, phone), as the e2e suite sends.
export function joinBody(n) {
  return {
    quantity: 1,
    answers: [
      { order: 0, template_name: 'name', answer: `Stress User ${n}` },
      { order: 1, template_name: 'form_email', answer: `stress.u${n}@stress.invalid` },
      { order: 2, template_name: 'phone', answer: '081200000000' },
    ],
  };
}

export function join(eventId, userNumber) {
  const res = post(`/events/${eventId}/join`, joinBody(userNumber), {
    kind: 'join',
    name: '/events/{id}/join',
    token: tokenAt(userNumber),
    expected: [422, 429],
  });
  if (res.status >= 200 && res.status < 300) joinOk.add(1);
  else if (res.status === 422) joinRefused.add(1);
  else if (res.status !== 403 && res.status !== 429 && res.status < 500) joinOther.add(1);
  return res;
}

// ---- Host dashboard ----------------------------------------------------------------------------

// Pages through the pass holders of the seeded host. A 500 here with a holder who has no username is KUYY-70.
export function passHolderPages(hostToken, pages = 20) {
  let offset = '';
  for (let i = 0; i < pages; i++) {
    const query = offset ? `&offset_id=${offset}` : '';
    const res = get(`/analytics/passes/participants?limit=20${query}`, {
      kind: 'dashboard',
      name: '/analytics/passes/participants',
      token: hostToken,
    });
    if (!check(res, { 'pass holders 200': (r) => r.status === 200 })) return;
    const body = res.json();
    // The response shape is not pinned here: accept a bare array or a wrapper. Check it with "make smoke".
    const list = Array.isArray(body) ? body : body.data || body.items || body.participants || [];
    if (list.length === 0) return;
    offset = list[list.length - 1].id;
    if (!offset) return;
  }
}

export function passHolderCount(hostToken) {
  get('/analytics/passes/participants/count', { kind: 'dashboard', name: '/analytics/passes/participants/count', token: hostToken });
}

// ---- Web (kuyy-web) ----------------------------------------------------------------------------

export function webPage() {
  const roll = Math.random();
  let path;
  if (roll < 0.25) path = '/';
  else if (roll < 0.55) path = `/activities/${need('hot_event_id')}`;
  else if (roll < 0.85) path = `/activities/${pick(fixtures.fill_event_ids?.length ? fixtures.fill_event_ids : [need('hot_event_id')])}`;
  else path = '/search';
  get(path, { kind: 'web', name: `web ${path.startsWith('/activities/') ? '/activities/{id}' : path}`, base: WEB });
}

export { fixtures };
