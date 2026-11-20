const thai = require('./carriers/thai.cjs');
const korean = require('./carriers/korean.cjs');
const singapore = require('./carriers/singapore.cjs');
const qatar = require('./carriers/qatar.cjs');
const finnair = require('./carriers/finnair.cjs');
const airindia = require('./carriers/airindia.cjs');
const turkish = require('./carriers/turkish.cjs');
const emirates = require('./carriers/emirates.cjs');
const jal = require('./carriers/jal.cjs');
const chinaAirlines = require('./carriers/china-airlines.cjs');
const ana = require('./carriers/ana.cjs');

const carriers = new Map([thai, korean, singapore, qatar, finnair, airindia, turkish, emirates, jal, chinaAirlines, ana]
  .map(carrier => [carrier.prefix, carrier]));

function routeAwb(input) {
  const match = /^(\d{3})-?(\d{8})$/.exec(input.replace(/[^\S\r\n]/g, ''));
  if (!match) throw new Error(`Invalid AWB "${input}". Use a 3-digit prefix and an 8-digit serial.`);
  const [, prefix, serial] = match;
  const carrier = carriers.get(prefix);
  if (!carrier) throw new Error(`No carrier adapter is configured for prefix ${prefix}.`);
  return { carrier, awb: { number: `${prefix}-${serial}`, prefix, serial } };
}

function shipmentDetail(carrier, awb, observation) {
  const directUrl = carrier.manualTrackingUrl?.(awb) ||
    (observation?.status === 'tracked' && observation.shipmentDetailUrl);
  if (directUrl) return { url: directUrl };
  return {
    url: carrier.trackingPage,
    searchNumber: carrier.serialOnly ? awb.serial : awb.prefix + awb.serial,
    ...(carrier.separatePrefix ? { searchPrefix: awb.prefix } : {})
  };
}

module.exports = { routeAwb, shipmentDetail };
