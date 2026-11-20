const assert = require('node:assert/strict');
const test = require('node:test');
const { routeAwb } = require('../src/carriers.cjs');
const { summarizePieces } = require('../src/pieces.cjs');

test('TK reports the newest milestone and keeps reserved pieces separate from departures', () => {
  const { awb, carrier } = routeAwb('235-0123 4567');
  assert.equal(awb.serial, '01234567');
  const manual = new URL(carrier.manualTrackingUrl(awb));
  assert.equal(manual.searchParams.get('awbNumber'), '01234567');

  const summary = '235-01234567\n12 piece(s)\n1,800.00 kg\n12.41 m3\nFrom\nBKK - BANGKOK\nTo\nSFO - SAN FRANCISCO';
  const history = [
    { Status: 'BKD', Description: 'Shipment Booked', Station: 'BKK',
      'Actual time': '30.10.2026 20:45', 'Actual pieces / weight': '- / - kg' },
    { Status: 'RCS', Description: 'Shipment Accepted', Station: 'BKK',
      'Actual time': '01.11.2026 03:10', 'Actual pieces / weight': '12 / 1800 kg' }
  ];
  const reservations = [
    { 'Flight No': 'TK0069', Segment: 'BKK-IST', ETD: '01.11.2026 23:10',
      'Pieces/Weight': '12 / 1800 kg', 'Approval Status': 'check icon' },
    { 'Flight No': 'TK0079', Segment: 'IST-SFO', ETD: '02.11.2026 13:50',
      'Pieces/Weight': '12 / 1800 kg', 'Approval Status': 'check icon' }
  ];
  const accepted = carrier.parseResult(summary, history, reservations);
  assert.equal(accepted.milestones[0].event, 'Shipment Accepted');
  assert.equal(accepted.milestones[0].piecesAsPublished, '12');
  assert.equal(accepted.route.destination, 'SFO');
  assert.equal(accepted.totalWeight, '1,800.00 kg');
  assert.equal(accepted.totalVolumeCbm, '12.41 CBM');
  const beforeDeparture = summarizePieces(accepted);
  assert.equal(beforeDeparture.total, 12);
  assert.equal(beforeDeparture.originDeparted, null);
  assert.deepEqual(beforeDeparture.flights.map(leg => [leg.flight, leg.kind, leg.pieces]),
    [['TK0069', 'booked', 12], ['TK0079', 'booked', 12]]);

  history.push({ Status: 'DEP', Description: 'Shipment Departed', Station: 'BKK',
    'Flight no': 'TK0069', 'Actual time': '02.11.2026 00:10', ETD: '01.11.2026 23:10',
    'Actual pieces / weight': '8 / 1200 kg' });
  const afterDeparture = summarizePieces(carrier.parseResult(summary, history, reservations));
  assert.equal(afterDeparture.originDeparted, 8);
  assert.deepEqual(afterDeparture.flights.map(leg => [leg.flight, leg.kind, leg.pieces]),
    [['TK0069', 'departed', 8], ['TK0079', 'booked', 12]]);
});
