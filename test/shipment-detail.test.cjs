const assert = require('node:assert/strict');
const test = require('node:test');
const { routeAwb, shipmentDetail } = require('../src/carriers.cjs');

test('provides an official tracking link for each supported airline', () => {
  const expected = [
    ['098', 'aicargoportal.airindia.com', '09801234567'],
    ['105', 'cargo.finnair.com', '10501234567'],
    ['131', 'prd.jal-ocp.champ.aero', '01234567'],
    ['157', 'www.qrcargo.com', '01234567'],
    ['176', 'eskycargo.emirates.com', '17601234567'],
    ['180', 'cargo.koreanair.com', '01234567'],
    ['205', 'www.anacargo.jp', '01234567'],
    ['217', 'chorus.thaicargo.com', '01234567'],
    ['235', 'www.turkishcargo.com', undefined],
    ['297', 'icargowebportal.china-airlines.com', '29701234567'],
    ['618', 'www.siacargo.com', '61801234567']
  ];
  for (const [prefix, host, searchNumber] of expected) {
    const { carrier, awb } = routeAwb(prefix + '-01234567');
    const detail = shipmentDetail(carrier, awb);
    const url = new URL(detail.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, host);
    assert.equal(detail.searchNumber, searchNumber, prefix);
    assert.equal(detail.searchPrefix, prefix === '131' ? prefix : undefined);
    if (prefix === '235') {
      assert.equal(url.searchParams.get('awbPrefix'), prefix);
      assert.equal(url.searchParams.get('awbNumber'), awb.serial);
    }
  }
});

test('uses a verified matching order link when the airline returns one', () => {
  for (const prefix of ['105', '176']) {
    const { carrier, awb } = routeAwb(prefix + '-01234567');
    const url = new URL(carrier.trackingPage);
    url.hash = '/shipments/list/123456?openedTab=tracking-details';
    const details = { shipmentDetailUrl: url.href };
    assert.deepEqual(shipmentDetail(carrier, awb, { ...details, status: 'tracked' }), { url: url.href });
    assert.deepEqual(shipmentDetail(carrier, awb, { ...details, status: 'unverified' }), shipmentDetail(carrier, awb));
  }
});
