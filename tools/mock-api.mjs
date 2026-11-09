// A stand-in for the KUYY API and web, to dry-run the scripts and the setup tools when no stress environment exists.
// It answers the paths they use. It proves that the scripts run and count correctly; it measures nothing.
//
//   node tools/mock-api.mjs                      serve on :3399
//   node tools/mock-api.mjs --fixtures .mock     also write .mock/fixtures.json and .mock/tokens.json for k6 alone
//
// Mimics the rules the scripts depend on: the Authorization header is the raw token (a "Bearer " prefix is refused
// with 403), a title with 8 or more digits in a row is refused, a full event answers 422, every 25th search answers
// 429, and only the host can cancel an event. GET /__stats counts the requests per X-Stress-Run header.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3399);
const SEATS = Number(process.env.MOCK_SEATS || 49); // for events the mock did not create

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const uuidOf = (text) => {
  const h = crypto.createHash('md5').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
// Not signed: the mock does not check signatures.
const accessToken = (sub, ttlSeconds = 1800) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ c: 2, r: 2, u: 2, d: 2, sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds })}.mock`;
// The user id of a live token, or null for a malformed or expired one.
const subOf = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp > Date.now() / 1000 ? payload.sub : null;
  } catch {
    return null;
  }
};

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--fixtures');
if (dirIndex >= 0) {
  const dir = args[dirIndex + 1];
  fs.mkdirSync(dir, { recursive: true });
  const ids = (n) => Array.from({ length: n }, () => crypto.randomUUID());
  const users = ids(600);
  fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify({
    hot_event_id: crypto.randomUUID(),
    hot_event_ids: ids(1),
    control_event_ids: ids(10),
    race_event_ids: ids(20),
    open_event_id: crypto.randomUUID(),
    fill_event_ids: ids(50),
    pass_host_id: users[0],
    user_ids_without_username: [],
    user_ids: users.slice(0, 50),
  }));
  const accounts = ['email,role,refresh_token'];
  for (let n = 1; n <= 40; n++) {
    const email = `account${n}@stress.invalid`;
    const role = n <= 3 ? 'host' : n === 4 ? 'passhost' : 'user';
    accounts.push(`${email},${role},rt.${uuidOf(email)}`);
  }
  fs.writeFileSync(path.join(dir, 'accounts.csv'), accounts.join('\n') + '\n');
  const exp = Math.floor(Date.now() / 1000) + 86400;
  fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(users.map((id) => ({ id, token: accessToken(id, 86400), exp }))));
  console.log(`wrote ${dir}/fixtures.json, ${dir}/tokens.json and ${dir}/accounts.csv`);
}

const events = new Map(); // events created through POST /api/events
const joined = new Map(); // seats taken in events the mock did not create
const runs = {};
let searches = 0;
const protectedPrefix = ['/api/events', '/api/timeline', '/api/users', '/api/analytics', '/api/v2/search/for-you', '/api/v2/search/trending'];

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const p = url.pathname;
  const body = req.method === 'POST' ? await readBody(req) : {};
  const run = req.headers['x-stress-run'];
  if (run) runs[run] = (runs[run] || 0) + 1;

  if (p === '/__stats') return send(res, 200, { runs, events: events.size });

  setTimeout(() => {
    if (!p.startsWith('/api/')) return send(res, 200, '<html><body>mock page</body></html>', 'text/html');

    // ---- sign-in -------------------------------------------------------------------------------
    if (p === '/api/auth/emailotp') return send(res, 204, '');
    if (p === '/api/auth/emailsignin' && req.method === 'POST') {
      if (!body.email || !body.otp) return send(res, 422, 'email and otp are required');
      const sub = uuidOf(body.email);
      return send(res, 200, { access_token: accessToken(sub), refresh_token: `rt.${sub}` });
    }
    if (p === '/api/auth/refresh' && req.method === 'POST') {
      const match = /^rt\.(.+)$/.exec(body.refresh_token || '');
      if (!match) return send(res, 401, 'invalid refresh token');
      return send(res, 200, { access_token: accessToken(match[1]), refresh_token: body.refresh_token });
    }

    // ---- everything else needs a raw access token -------------------------------------------------
    const auth = req.headers.authorization || '';
    const sub = auth.startsWith('Bearer ') ? null : subOf(auth);
    const needsToken = protectedPrefix.some((x) => p === x || p.startsWith(`${x}/`));
    if (needsToken && !sub) return send(res, 403, { message: auth ? 'token is malformed or expired' : 'Missing auth token' });

    if (p === '/api/events' && req.method === 'POST') {
      if (!body.name || !body.limit || !body.start_timestamp) return send(res, 422, 'name, limit and start_timestamp are required');
      if (/\d{8,}/.test(`${body.name} ${body.description || ''}`)) return send(res, 422, 'Title or description looks like a phone number');
      const id = crypto.randomUUID();
      events.set(id, { id, name: body.name, limit: body.limit, members: 1, host: sub, status: 'scheduled' });
      return send(res, 200, { id, status: 'scheduled', host_id: sub });
    }

    const join = p.match(/^\/api\/events\/([^/]+)\/join$/);
    if (join && req.method === 'POST') {
      const event = events.get(join[1]);
      const quantity = body.quantity || 1;
      if (event) {
        if (event.status !== 'scheduled' || event.members + quantity > event.limit) return send(res, 422, 'Event is full');
        event.members += quantity;
        return send(res, 200, { message: 'ok' });
      }
      const n = (joined.get(join[1]) || 0) + 1;
      joined.set(join[1], n);
      return n <= SEATS ? send(res, 200, { message: 'ok' }) : send(res, 422, 'Event is full');
    }

    const cancel = p.match(/^\/api\/events\/([^/]+)\/cancel$/);
    if (cancel && req.method === 'POST') {
      const event = events.get(cancel[1]);
      if (!event) return send(res, 404, 'not found');
      if (event.host !== sub) return send(res, 422, 'only the host can cancel');
      if (event.status !== 'scheduled') return send(res, 422, 'already cancelled');
      event.status = 'canceled';
      return send(res, 200, { message: 'ok' });
    }

    const detail = p.match(/^\/api\/(?:public\/)?events\/([^/]+)$/);
    if (detail && req.method === 'GET' && events.has(detail[1])) {
      const e = events.get(detail[1]);
      return send(res, 200, { id: e.id, name: e.name, limit: e.limit, members_count: e.members, status: e.status });
    }

    if (p === '/api/v2/search/activities') {
      searches += 1;
      return searches % 25 === 0 ? send(res, 429, { message: 'Too many requests' }) : send(res, 200, { data: [] });
    }
    if (p === '/api/analytics/passes/participants') {
      // The cursor is the id of the last holder of the previous page: page-<n>-<i>.
      const offset = url.searchParams.get('offset_id');
      const pageNo = offset ? Number(offset.split('-')[1]) + 1 : 0;
      if (pageNo >= 3) return send(res, 200, { data: [] });
      return send(res, 200, { data: Array.from({ length: 20 }, (_, i) => ({ id: `page-${pageNo}-${i}`, username: i % 7 ? `u${i}` : '' })) });
    }
    return send(res, 200, { data: [], mock: true });
  }, 5 + Math.random() * 25);
});

server.listen(PORT, () => console.log(`mock API and web on http://localhost:${PORT}`));
