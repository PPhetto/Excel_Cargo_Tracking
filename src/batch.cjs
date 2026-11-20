const { join } = require('node:path');
const { routeAwb, shipmentDetail } = require('./carriers.cjs');
const { summarizePieces } = require('./pieces.cjs');

async function trackBatch(inputs, { channel, headed = false, evidenceDir, captureQuickImage = false, onResult = () => {} } = {}) {
  const targets = inputs.map(routeAwb);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel, headless: !headed });
  const browserVersion = browser.version();
  const results = [];
  const blockedCarriers = new Set();
  try {
    for (const [index, { carrier, awb }] of targets.entries()) {
      let observation;
      let context;
      try {
        if (blockedCarriers.has(awb.prefix)) {
          observation = { status: 'skipped', message: 'The carrier blocked a previous check.' };
        } else {
          context = await browser.newContext({ acceptDownloads: false, locale: 'en-US' });
          const screenshotPath = evidenceDir && join(evidenceDir, `${index + 1}-${awb.number}.png`);
          observation = await carrier.track(context, awb, { screenshotPath, captureQuickImage });
          if (observation.status === 'blocked') blockedCarriers.add(awb.prefix);
        }
      } catch (error) {
        observation = { status: 'unverified', message: error.message.split('\n')[0] };
      } finally {
        await context?.close().catch(() => {});
      }
      const { quickImage, ...shipStatus } = observation;
      const result = {
        awb: awb.number, carrier: carrier.name, observedAt: new Date().toISOString(),
        milestones: [], ...shipStatus, shipmentDetail: shipmentDetail(carrier, awb, shipStatus)
      };
      if (result.status === 'tracked') result.pieceTracking = summarizePieces(result);
      else if (carrier.manualTrackingUrl) result.manualTrackingUrl = carrier.manualTrackingUrl(awb);
      if (carrier.manualOnBlock && ['blocked', 'skipped'].includes(result.status)) result.manualCheckRequired = true;
      results.push(result);
      onResult(quickImage ? { ...result, quickImage } : result);
    }
  } finally {
    await browser.close();
  }
  return {
    schemaVersion: 1,
    browser: { channel: channel || 'chromium', version: browserVersion, headless: !headed },
    results
  };
}

module.exports = { trackBatch };
