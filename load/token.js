// Claim: a token works on any request, whichever copy answers it.
//
// Sends authenticated GET /bookings through the proxy and fails if any
// request is not a 200. Also reports which copies answered (X-Upstream).
//
//   docker compose run --rm --no-deps k6 run -e TOKEN=<token> /load/token.js
//
// TOKEN is one of the bearer tokens a copy printed at startup.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://proxy:80';
const TOKEN = __ENV.TOKEN;

// One VU, so the per-VU set below sees every response and the counter is the
// exact number of distinct copies that answered.
export const options = {
  vus: 1,
  iterations: 60,
  thresholds: {
    // Fails the run if a single request is rejected.
    checks: ['rate==1.0'],
  },
};

const distinctUpstreams = new Counter('distinct_upstreams');
const rejectedBy = new Counter('rejected_requests');
const seen = new Set();

export function setup() {
  if (!TOKEN) {
    throw new Error('Pass a token: k6 run -e TOKEN=<token> /load/token.js');
  }
}

export default function () {
  const res = http.get(`${BASE}/bookings`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const upstream = res.headers['X-Upstream'] || 'unknown';

  if (!seen.has(upstream)) {
    seen.add(upstream);
    distinctUpstreams.add(1);
    console.log(`new upstream answered: ${upstream}`);
  }

  const ok = check(res, { 'token accepted (200)': (r) => r.status === 200 });
  if (!ok) {
    rejectedBy.add(1, { upstream });
    console.log(`rejected by ${upstream}: ${res.status} ${res.body}`);
  }
}
