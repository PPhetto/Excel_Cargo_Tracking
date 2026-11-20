const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeDestinationArrival } = require('../src/carriers/singapore-arrival.cjs');
const { reconcileStatus } = require('../src/carriers/singapore.cjs');

function milestone(station, event, flight, pieces, when) {
  return {
    station, event, flightDetailsAsPublished: flight, piecesAsPublished: pieces,
    statusDateAsPublished: when
  };
}

const first = milestone('MLE', 'Arrived', 'SQ 0432', '73', '09 Nov 26 | 11:41');
const second = milestone('MLE', 'Arrived', 'SQ 0438', '36', '09 Nov 26 | 22:25');
const history = [
  milestone('BKK', 'Departed', 'SQ 0713', '73', '08 Nov 26 | 20:00'),
  milestone('SIN', 'Arrived', 'SQ 0713', '73', '09 Nov 26 | 00:15'),
  milestone('BKK', 'Departed', 'SQ 0705', '36', '09 Nov 26 | 09:36'),
  milestone('SIN', 'Arrived', 'SQ 0705', '36', '09 Nov 26 | 13:06'),
  milestone('SIN', 'Checked into warehouse', 'SQ 0705', '218', '09 Nov 26 | 13:50'),
  first,
  milestone('MLE', 'Ready for pick-up', 'NA', '73', '09 Nov 26 | 16:27'),
  second,
  milestone('MLE', 'Checked into warehouse', 'SQ 0438', '109', '10 Nov 26 | 00:03'),
  milestone('MLE', 'Ready for pick-up', 'NA', '36', '10 Nov 26 | 00:51')
];

test('reconciles the live SQ split against the AWB total using only destination arrivals', () => {
  const arrival = summarizeDestinationArrival('MLE', 109, [...history].reverse());
  assert.equal(arrival.arrived, 109);
  assert.equal(arrival.warehousePieces, 109);
  assert.deepEqual(arrival.arrivals.map(({ flight, pieces }) => [flight, pieces]), [['SQ0432', 73], ['SQ0438', 36]]);
  const state = reconcileStatus('NFD', '09 Nov 26 | 19:51', [], history, arrival);
  assert.equal(state.carrierSummary.event, 'NFD');
  assert.equal(state.milestones[0].event, '109/109 pieces arrived at MLE');
  assert.equal(state.milestones[0].statusDateAsPublished, '09 Nov 26 | 22:25');
});

test('shows a partial arrival even when the same flight is reported twice', () => {
  const arrival = summarizeDestinationArrival('MLE', 109, [first, { ...first, flightDetailsAsPublished: 'SQ432' }]);
  assert.equal(arrival.arrived, 73);
  assert.equal(arrival.warehousePieces, null);
  assert.equal(reconcileStatus('ARR', '', [], [first], arrival).milestones[0].event, '73/109 pieces arrived at MLE');
});

test('does not infer an arrival from pickup, conflicting counts, missing quantities, or a sum above the AWB total', () => {
  assert.equal(summarizeDestinationArrival('MLE', 109, history.filter(row => row.event !== 'Arrived')), null);
  assert.equal(summarizeDestinationArrival('MLE', 109, [first, { ...first, piecesAsPublished: '36' }]), null);
  assert.equal(summarizeDestinationArrival('MLE', 109, [first, { ...second, piecesAsPublished: '' }]), null);
  assert.equal(summarizeDestinationArrival('MLE', 100, [first, second]), null);
});

test('preserves the delivered headline when the carrier reports delivery', () => {
  const arrival = summarizeDestinationArrival('MLE', 109, history);
  assert.equal(reconcileStatus('DLV', '', [], history, arrival).milestones[0].event, 'DLV');
});
