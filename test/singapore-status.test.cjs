const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileStatus } = require('../src/carriers/singapore.cjs');
const { summarizePieces } = require('../src/pieces.cjs');

const summaryDate = '22 Oct 26 | 10:26';
const legs = [
  { origin: 'BKK', destination: 'SIN', flight: 'SQ 0713', departureAsPublished: '12 Nov 26 | 20:00', bookingStatus: 'Cancelled', pieces: 30 },
  { origin: 'SIN', destination: 'MLE', flight: 'SQ 0432', departureAsPublished: '13 Nov 26 | 10:05', bookingStatus: 'Cancelled', pieces: 30 }
];

test('cancelled booking legs override the booked summary without inventing a cancellation time', () => {
  const tracking = reconcileStatus('BKD', summaryDate, legs, []);
  assert.equal(tracking.bookingCancellation, 'all');
  assert.deepEqual(tracking.milestones[0], { event: 'Booking cancelled' });
  assert.equal(tracking.carrierSummary.statusDateAsPublished, summaryDate);
  const pieces = summarizePieces({ ...tracking, totalPieces: 30, route: { origin: 'BKK' }, schedule: { legs } });
  assert.equal(pieces.originDeparted, null);
  assert.deepEqual(pieces.flights.map(leg => [leg.kind, leg.pieces]), [['cancelled', 30], ['cancelled', 30]]);
});

test('keeps cancelled and confirmed bookings separate', () => {
  const mixed = [legs[0], { ...legs[1], bookingStatus: 'Confirmed' }];
  const tracking = reconcileStatus('BKD', summaryDate, mixed, []);
  assert.equal(tracking.bookingCancellation, 'some');
  assert.equal(tracking.milestones[0].event, 'Booked · cancellation reported');
  const pieces = summarizePieces({ ...tracking, route: { origin: 'BKK' }, schedule: { legs: mixed } });
  assert.deepEqual(pieces.flights.map(leg => leg.kind), ['booked', 'cancelled']);
});

test('real cargo movement takes precedence over the booked summary without hiding cancellations', () => {
  const actual = { event: 'Arrived', station: 'SIN', statusDateAsPublished: '12 Nov 26 | 23:40' };
  const tracking = reconcileStatus('BKD', summaryDate, legs, [actual]);
  assert.equal(tracking.bookingCancellation, 'all');
  assert.deepEqual(tracking.milestones, [actual]);
  assert.equal(reconcileStatus('DLV', summaryDate, legs, [actual]).milestones[0].event, 'DLV');
});

test('marks booked status as summary only when leg details are unavailable', () => {
  assert.equal(reconcileStatus('BKD', summaryDate, [], []).milestones[0].event, 'Booked (summary only)');
  assert.equal(reconcileStatus('BKD', summaryDate, [{ ...legs[0], bookingStatus: 'Confirmed' }], [])
    .milestones[0].event, 'Booked (BKD)');
});
