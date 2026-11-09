// A small client for the KUYY API, shared by the setup, login, verify and teardown tools. No dependencies.
//
// Two rules of the API that matter here (cmd/http/main.go):
//   - it is mounted under /api;
//   - the Authorization header is the RAW token, with no "Bearer " prefix.
// Every request carries X-Stress-Run, so a run can be found again in the server's logs.
import fs from 'node:fs';
import path from 'node:path';

export const BASE = (process.env.BASE_URL || 'http://localhost:3333').replace(/\/+$/, '') + '/api';
export const RUN_ID = process.env.RUN_ID || 'manual';

// Where accounts.csv, tokens.json, fixtures.json and state/ live: the project folder, or DATA_DIR (the dry run uses .mock).
export const out = (name) => path.join(process.env.DATA_DIR || '.', name);

export async function call(method, path, { token, body, query } = {}) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  const headers = { 'Content-Type': 'application/json', 'X-Stress-Run': RUN_ID };
  if (token) headers.Authorization = token;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    return { status: 0, text: `network error: ${error.message}`, json: undefined };
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

export function ok(res) {
  return res.status >= 200 && res.status < 300;
}

export function describe(res) {
  return `${res.status} ${String(res.text).slice(0, 160)}`;
}

// The payload of a JWT. The signature is not checked: only the API can do that.
export function claims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

// Runs fn over items with at most `limit` in flight. Results keep the order of items.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// CSV without quoting: one header line, then one account per line. Blank lines and lines starting with # are skipped.
export function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length === 0) throw new Error(`${file} is empty`);
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));
  });
}

// Mode 0600: the file holds working credentials.
export function writeCsv(file, rows, columns) {
  const lines = [columns.join(','), ...rows.map((row) => columns.map((c) => row[c] ?? '').join(','))];
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function writeJson(file, value, mode = 0o644) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode });
  fs.chmodSync(file, mode); // writeFileSync sets the mode only when it creates the file
}

export function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`${file} does not exist. Run "make setup" first.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The device fields that sign-in and refresh accept.
export const DEVICE = { device_id: 'stress-test', device_model: 'stress-test', os_version: '1.0', latitude: 0, longitude: 0 };
