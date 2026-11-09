// A3. Signed-in feed: list, timeline, for-you, trending. Hypothesis H1 (seat counting in feed and list SQL).
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { feedEvents, feedForYou, feedTimeline, feedTrending } from '../lib/actions.js';

export const options = {
  scenarios: { a3: arrivalScenario() },
  thresholds: thresholds(['read_login']),
};

export default function () {
  const roll = Math.random();
  if (roll < 0.4) feedEvents();
  else if (roll < 0.7) feedTimeline();
  else if (roll < 0.9) feedForYou();
  else feedTrending();
}
