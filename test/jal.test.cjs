const assert = require('node:assert/strict');
const test = require('node:test');
const { readMilestones } = require('../src/carriers/jal.cjs');

test('JAL trusts the highlighted status and leaves its missing date and time blank', () => {
  const rows = [
    { cells: ['', 'Departed', 'BKK', '', '', '31/12/2026', '21:40'], current: false, pairedWithNext: true },
    { cells: ['', 'Arrived', 'HND', 'JL034', 'AKE00000JL', '01/01/2027', '06:02'], current: false },
    { cells: ['', 'Custom Info', 'HND', '-', '-', '', ''], current: false },
    { cells: ['', 'Delivered', 'HND', '-', '-', '', ''], current: true }
  ];
  const result = readMilestones([{ rows, pieces: '1' }]);
  assert.deepEqual(result.map(({ event }) => event), ['Delivered', 'Arrived', 'Departed']);
  assert.equal(result[0].statusDateAsPublished, undefined);
  assert.equal(result[0].station, 'HND');
  assert.equal(result[1].statusDateAsPublished, '01 Jan 2027 06:02');
  assert.equal(result[2].flightDetailsAsPublished, 'JL034 BKK-HND');
  assert.equal(result[2].piecesAsPublished, 1);
});
