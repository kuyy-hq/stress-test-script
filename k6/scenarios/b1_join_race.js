// B1. Many users join the same small event at the same moment. Hypothesis H3 (pool of 10 connections per
// replica, advisory lock per event).
//
// One iteration per user, all started together. Reset the event first ("make reseed"), because a second run
// finds it already full. After the run, "make invariants" must show no oversold event and no counter drift.
//
//   RACE_USERS   number of users joining (default 500, never more than the number of tokens)
//   RACE_EVENT   index in fixtures.race_event_ids (default 0)
import { need } from '../lib/fixtures.js';
import { tokenCount, tokensMustLast } from '../lib/auth.js';
import { thresholds } from '../lib/thresholds.js';
import { join } from '../lib/actions.js';

const USERS = Math.min(Number(__ENV.RACE_USERS || 500), tokenCount());
const EVENT = Number(__ENV.RACE_EVENT || 0);
tokensMustLast(120);

export const options = {
  scenarios: {
    race: { executor: 'shared-iterations', vus: USERS, iterations: USERS, maxDuration: '2m' },
  },
  thresholds: thresholds(['join'], {
    // join_other would be a 400, 401 or 404: a broken request, not a race result.
    join_other: ['count==0'],
  }),
};

export default function () {
  const eventId = need('race_event_ids')[EVENT];
  join(eventId, __VU);
}

export function teardown() {
  console.log('Done. Now run "make invariants": an oversold event or a drifting seat counter is a failure.');
}
