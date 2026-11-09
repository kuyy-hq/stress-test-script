// I1. Realistic mixed traffic. The weights are PROPOSALS (see the plan): replace them with production numbers.
// They are shares of REQUESTS and add up to 100%, so TARGET_RPS is the total request rate of the whole mix.
//
//   public list + detail  70%   (A1, A2)       feed and search, signed in  20%   (A3, A4)
//   join                    4%   (B1)           host dashboard               6%   (D1)
//
// One dashboard iteration is 6 requests (the count and 5 pages), so its arrival rate is 1/6 of its share.
// Joins go to the race events and start to be refused with 422 once they are full: that is counted, not failed.
// Run it with PROFILE=load, then stress, then soak.
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { need, pick } from '../lib/fixtures.js';
import { tokenCount, tokenOfUser } from '../lib/auth.js';
import {
  controlEventDetail, feedEvents, feedForYou, feedTimeline, hotEventDetail, hotEventMembers,
  join, passHolderCount, passHolderPages, publicList, searchActivities,
} from '../lib/actions.js';

const DASHBOARD_REQUESTS = 6; // passHolderCount plus 5 pages

export const options = {
  scenarios: {
    browse: arrivalScenario({ exec: 'browse', weight: 0.7 }),
    feed: arrivalScenario({ exec: 'feed', weight: 0.2 }),
    booking: arrivalScenario({ exec: 'booking', weight: 0.04 }),
    dashboard: arrivalScenario({ exec: 'dashboard', weight: 0.06 / DASHBOARD_REQUESTS }),
  },
  thresholds: thresholds(['read_public', 'read_hot', 'read_control', 'read_login', 'search', 'join', 'dashboard']),
};

export function setup() {
  return { hostToken: tokenOfUser(need('pass_host_id')) };
}

export function browse() {
  const roll = Math.random();
  if (roll < 0.45) publicList();
  else if (roll < 0.7) hotEventDetail();
  else if (roll < 0.85) hotEventMembers();
  else controlEventDetail();
}

export function feed() {
  const roll = Math.random();
  if (roll < 0.35) feedEvents();
  else if (roll < 0.6) feedTimeline();
  else if (roll < 0.75) feedForYou();
  else searchActivities();
}

export function booking() {
  join(pick(need('race_event_ids')), Math.floor(Math.random() * tokenCount()));
}

export function dashboard(data) {
  passHolderCount(data.hostToken);
  passHolderPages(data.hostToken, DASHBOARD_REQUESTS - 1);
}
