import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { API, RUN_ID, SPREAD_IP } from './config.js';

// Counted by status, so a run shows the refusals that must stay at zero separately from the ones that are fine.
export const status403 = new Counter('status_403'); // a business rule refused with 403 makes kuyy-web refresh the token and retry
export const status5xx = new Counter('status_5xx');
export const status429 = new Counter('status_429'); // the rate limiter. Expected on limited routes, reported on its own
export const status422 = new Counter('status_422'); // a business refusal, for example an event that is full

function randomOctet() {
  return Math.floor(Math.random() * 254) + 1;
}

function headers(token) {
  const h = { 'Content-Type': 'application/json', 'X-Stress-Run': RUN_ID };
  // The API reads the raw token. There is no "Bearer " prefix (cmd/http/main.go authorize and parseToken).
  if (token) h.Authorization = token;
  if (SPREAD_IP) h['X-Forwarded-For'] = `10.${randomOctet()}.${randomOctet()}.${randomOctet()}, 127.0.0.1`;
  return h;
}

function count(res) {
  if (res.status === 403) status403.add(1);
  else if (res.status === 429) status429.add(1);
  else if (res.status === 422) status422.add(1);
  else if (res.status >= 500) status5xx.add(1);
}

// kind groups requests for the thresholds (see thresholds.js). name keeps a URL with ids from becoming
// one metric series per id. expected lists the 4xx statuses that are not failures for this request.
export function request(method, path, { token, body, kind, name, expected = [], base = API } = {}) {
  const params = {
    headers: headers(token),
    tags: { kind, name: `${method} ${name || path}` },
    responseCallback: http.expectedStatuses({ min: 200, max: 399 }, ...expected),
  };
  const url = `${base}${path}`;
  const res = method === 'GET' ? http.get(url, params) : http.post(url, body === undefined ? null : JSON.stringify(body), params);
  count(res);
  return res;
}

export function get(path, options) {
  return request('GET', path, options);
}

export function post(path, body, options) {
  return request('POST', path, { ...options, body });
}
