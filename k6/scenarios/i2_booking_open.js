// I2. Booking opens for a popular event. Each visitor reads the detail and the guest list, then tries to join once.
// Hypotheses H2 and H3 together. Its numbers decide whether a queue or waiting room is needed.
//
//   VISITORS   peak number of visitors (default 2000, never more than the number of tokens).
//              A visitor makes 2 requests about every 4 seconds, so 2000 visitors is about 1000 requests per second.
//
// The open event has 200 seats. After the run, "make invariants" must show it filled to its limit and no more.
import { sleep } from 'k6';
import { need } from '../lib/fixtures.js';
import { tokenCount, tokensMustLast } from '../lib/auth.js';
import { thresholds } from '../lib/thresholds.js';
import { hotEventMembers, join } from '../lib/actions.js';
import { get } from '../lib/http.js';

const VISITORS = Math.min(Number(__ENV.VISITORS || 2000), tokenCount());
const SCALE = Number(__ENV.DURATION_SCALE || 1);
const seconds = (n) => `${Math.max(1, Math.round(n * SCALE))}s`;
tokensMustLast((240 + 30) * SCALE);

export const options = {
  scenarios: {
    opening: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: seconds(30), target: VISITORS },
        { duration: seconds(180), target: VISITORS },
        { duration: seconds(30), target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: thresholds(['read_hot', 'join'], { join_other: ['count==0'] }),
};

let joined = false;

export default function () {
  const open = need('open_event_id');
  get(`/public/events/${open}`, { kind: 'read_hot', name: '/public/events/{id} (open)' });
  hotEventMembers();
  sleep(1 + Math.random() * 2);
  if (!joined) {
    joined = true; // each virtual user tries once, like a visitor who clicks Join
    join(open, __VU);
  }
  sleep(1 + Math.random() * 2);
}
