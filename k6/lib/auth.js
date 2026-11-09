import { SharedArray } from 'k6/data';
import { TOKENS_FILE } from './config.js';

// tokens.json is written by tools/mint: [{"id": "<user id>", "token": "<jwt>"}].
const tokens = new SharedArray('tokens', () => JSON.parse(open(TOKENS_FILE)));

// API tokens live 30 minutes. A run that outlasts them would turn into a wall of 403s, so refuse to start.
// tokens.json written by tools/mint (direct mode) lives longer.
export function tokensMustLast(seconds) {
  const exps = tokens.map((t) => t.exp).filter((e) => typeof e === 'number');
  if (exps.length === 0) return; // an older tokens.json without expiry: nothing to check
  const remaining = Math.min(...exps) - Date.now() / 1000;
  if (remaining < seconds + 60) {
    throw new Error(
      `The tokens expire in ${Math.floor(remaining / 60)} minutes, but this run needs ${Math.ceil(seconds / 60)} minutes. ` +
        'Run "make tokens" first. API tokens last 30 minutes: for a longer run use "make db-tokens" (needs the AUTH_SECRET of the stress API).',
    );
  }
}

export function tokenCount() {
  return tokens.length;
}

// The nth token, wrapping around, so the same virtual user keeps the same account.
export function tokenAt(n) {
  return tokens[n % tokens.length].token;
}

export function randomToken() {
  return tokens[Math.floor(Math.random() * tokens.length)].token;
}

// Linear search. Call it from setup(), not from the iteration.
export function tokenOfUser(id) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].id === id) return tokens[i].token;
  }
  throw new Error(`no token for user ${id}. Mint tokens after seeding.`);
}
