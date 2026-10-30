// Claim: a room slot is booked at most once.
//
// Books the same room and the same slot directly on each copy, each with that
// copy's own token, and fails if more than one booking is confirmed (201).
// It goes around the proxy on purpose: through the proxy we could not choose
// which copy gets which request, and a token only works on the copy that
// issued it.
//
//   docker compose run --rm --no-deps k6 run \
//     -e API1=<copy 1 name> -e TOKEN1=<copy 1 token> \
//     -e API2=<copy 2 name> -e TOKEN2=<copy 2 token> \
//     /load/double_booking.js
//
// Each copy keeps its bookings until it restarts, so a second run against the
// same copies sees the slot taken (202, waitlisted). Pass SLOT_START for a
// fresh slot, or restart the api copies.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const ROOM = __ENV.ROOM || 'r-1';
const MINUTES = __ENV.MINUTES || '60';

// Tomorrow 10:00 UTC by default. The booking rules want a future start, on a
// 15-minute boundary, inside 06:00-22:00 UTC, and at most 14 days ahead for a
// study room.
function defaultStart() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}
const START = __ENV.SLOT_START || defaultStart();

const copies = [
  { name: __ENV.API1 || 'f26-lab09-api-1', token: __ENV.TOKEN1 },
  { name: __ENV.API2 || 'f26-lab09-api-2', token: __ENV.TOKEN2 },
];

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // Fails the run if the slot was confirmed more than once.
    confirmed_bookings: ['count<=1'],
    // Fails the run if any request errored or got no response (for example
    // "no such host" when a copy is missing), so a broken run cannot pass.
    request_errors: ['count==0'],
    // Fails the run unless every request was answered with 201 or 202.
    checks: ['rate==1.0'],
  },
};

const confirmed = new Counter('confirmed_bookings');
const requestErrors = new Counter('request_errors');

export function setup() {
  for (const copy of copies) {
    if (!copy.token) {
      throw new Error('Pass TOKEN1 and TOKEN2, one token from each copy.');
    }
  }
}

export default function () {
  console.log(`booking room ${ROOM} at ${START} for ${MINUTES} minutes on each copy`);
  for (const copy of copies) {
    // k6 sends an object body as application/x-www-form-urlencoded, which is
    // what the API reads.
    const res = http.post(
      `http://${copy.name}:8080/bookings`,
      { roomId: ROOM, start: START, minutes: MINUTES },
      { headers: { Authorization: `Bearer ${copy.token}` } },
    );
    console.log(`${copy.name} -> ${res.status} ${res.error || res.body}`);
    // k6 reports a transport failure as status 0 with res.error set.
    if (res.status === 0 || res.error) {
      requestErrors.add(1, { copy: copy.name });
    }
    check(res, {
      'got a response': (r) => r.status !== 0,
      'request was understood (201 or 202)': (r) => r.status === 201 || r.status === 202,
    });
    if (res.status === 201) {
      confirmed.add(1, { copy: copy.name });
    }
  }
}
