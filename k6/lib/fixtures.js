import { FIXTURES_FILE } from './config.js';

// fixtures.json is written by "make fixtures" (sql/export_fixtures.sql).
export const fixtures = JSON.parse(open(FIXTURES_FILE));

export function need(name) {
  const value = fixtures[name];
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    throw new Error(`fixture "${name}" is empty. Run "make seed" and "make fixtures" first.`);
  }
  return value;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
