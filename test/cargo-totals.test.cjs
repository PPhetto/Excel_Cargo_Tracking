const assert = require('node:assert/strict');
const test = require('node:test');
const { labeledValue, publishedWeight, publishedVolume } = require('../src/cargo-totals.cjs');

test('reads published shipment measurements and preserves decimal precision', () => {
  assert.equal(publishedWeight('1,741\nkg'), '1,741 kg');
  assert.equal(publishedWeight('958 K'), '958 kg');
  assert.equal(publishedWeight('2,400 L'), '2,400 lb');
  assert.equal(publishedWeight('864.00'), '864.00 (weight)');
  assert.equal(publishedVolume('4.10 m3'), '4.10 CBM');
  assert.equal(publishedVolume('16.7872 CM'), '16.7872 CBM');
  assert.equal(publishedVolume('12.41 m³'), '12.41 CBM');
});

test('leaves unavailable totals blank and does not label an unspecified volume as CBM', () => {
  const contents = 'TOTAL PIECES\n109\nTOTAL WEIGHT\n\n1,331 kg\nChargeable weight\n1,400 kg';
  assert.equal(labeledValue(contents, 'Total weight'), '1,331 kg');
  assert.equal(publishedWeight(labeledValue(contents, 'Volume')), undefined);
  assert.equal(publishedVolume('4.10'), undefined);
  assert.equal(publishedVolume('4.10 CF'), undefined);
  assert.equal(publishedWeight('—'), undefined);
});
