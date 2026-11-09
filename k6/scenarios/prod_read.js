// Production-safe read mix. TARGET_RPS is split across public list, event detail, and anonymous search.
import { publicList, hotEventDetail, searchActivities } from '../lib/actions.js';
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';

const WEIGHT = 1 / 3;

export const options = {
  scenarios: {
    public_list: arrivalScenario({ exec: 'list', weight: WEIGHT, requiresToken: false }),
    event_detail: arrivalScenario({ exec: 'detail', weight: WEIGHT, requiresToken: false }),
    search: arrivalScenario({ exec: 'search', weight: WEIGHT, requiresToken: false }),
  },
  thresholds: thresholds(['read_public', 'read_hot', 'search']),
};

export function list() {
  publicList();
}

export function detail() {
  hotEventDetail();
}

export function search() {
  searchActivities(true);
}
