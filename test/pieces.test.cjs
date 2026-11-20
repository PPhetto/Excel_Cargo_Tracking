const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pieceCount, summarizePieces } = require('../src/pieces.cjs');

function thaiEvent(event, count, flight, day, station = 'BKK') {
  return {
    event, station, piecesAsPublished: count,
    statusDateAsPublished: '17 NOV 2026 10:00',
    flightDetailsAsPublished: flight + ', ' + day + ' NOV 2026, STD 20:00, BKK-LHR'
  };
}

test('shows 70 departed and a separate 30-piece booking without counting the original booking again', () => {
  const tracked = summarizePieces({
    totalPieces: 100,
    route: { origin: 'BKK' },
    milestones: [
      thaiEvent('Departed', '70', 'TG0910', 17),
      thaiEvent('Booking Confirmed', '70', 'TG0910', 17),
      thaiEvent('Booking Confirmed', '30', 'TG0916', 18)
    ]
  });
  assert.equal(tracked.total, 100);
  assert.equal(tracked.originDeparted, 70);
  assert.deepEqual(tracked.flights.map(({ kind, pieces }) => [kind, pieces]), [
    ['departed', 70], ['booking reported', 30]
  ]);
  assert.equal(tracked.flights[1].dateAsPublished, '18 NOV 2026 20:00');
});

test('does not count a connection or destination handling toward pieces leaving the origin', () => {
  const tracked = summarizePieces({
    totalPieces: '100 pcs',
    route: { origin: 'BKK' },
    milestones: [
      thaiEvent('Received from Flight', '50', 'TG0910', 17, 'LHR'),
      thaiEvent('Received from Flight', '50', 'TG0910', 17, 'LHR'),
      thaiEvent('Departed', '100', 'TG0911', 18, 'ICN'),
      thaiEvent('Departed', '100', 'TG0910', 17)
    ]
  });
  assert.equal(tracked.originDeparted, 100);
  assert.deepEqual(tracked.flights.map(leg => leg.origin), ['ICN', 'BKK']);
});

test('leaves the departure sum blank when a flight count is unknown or ambiguous', () => {
  const result = { totalPieces: 100, route: { origin: 'BKK' } };
  assert.equal(summarizePieces({ ...result, milestones: [
    thaiEvent('Departed', '70', 'TG0910', 17),
    thaiEvent('Departed', '-', 'TG0916', 18)
  ] }).originDeparted, null);
  assert.equal(summarizePieces({ ...result, milestones: [
    thaiEvent('Departed', '70', 'TG0910', 17),
    thaiEvent('Departed', '30', 'TG0910', 17)
  ] }).originDeparted, null);
  assert.equal(pieceCount('70/100'), null);
  assert.equal(pieceCount('1,250 PCS'), 1250);
});

test('keeps a confirmed itinerary separate from an actual departure', () => {
  const tracked = summarizePieces({
    totalPieces: 120, route: { origin: 'BKK' }, milestones: [],
    schedule: { legs: [
      { origin: 'BKK', flight: 'SQ 0713', departureAsPublished: '17 Nov 26 | 20:00', pieces: 120, bookingStatus: 'Confirmed' },
      { origin: 'SIN', flight: 'SQ 0432', departureAsPublished: '18 Nov 26 | 10:05', pieces: 120, bookingStatus: 'Confirmed' }
    ] }
  });
  assert.equal(tracked.originDeparted, null);
  assert.deepEqual(tracked.flights.map(({ kind, pieces }) => [kind, pieces]), [['booked', 120], ['booked', 120]]);
});
