const { trackIcargo } = require('./icargo-tracker.cjs');

const prefix = '205';
const name = 'ANA Cargo';
const entry = 'https://www.anacargo.jp/en/int/';
const resultOrigin = 'https://prd.intcgo.ana.co.jp';
const resultPath = '/icargoneoportal/app/main/';

async function openShipment(page, awb, useResultPage) {
  const form = page.locator('.trackshipments');
  const prefixInput = form.locator('input[name="code01"]');
  if (await prefixInput.inputValue() !== awb.prefix) throw new Error('ANA did not show the expected 205 prefix.');
  await form.getByPlaceholder('Air Waybill Number', { exact: true }).fill(awb.serial);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    form.getByRole('link', { name: 'Search', exact: true }).click()
  ]);
  useResultPage(popup);
  await popup.waitForLoadState('domcontentloaded');
  popup.setDefaultTimeout(20_000);
  const address = new URL(popup.url());
  if (address.origin !== resultOrigin || address.pathname !== resultPath) {
    throw new Error('ANA opened an unexpected tracking result address.');
  }
  return popup;
}

const options = { entry, name, airline: 'NH', preview: true, openShipment };

module.exports = { prefix, name, trackingPage: entry, serialOnly: true, manualOnBlock: true,
  track: (context, awb, settings) => trackIcargo(context, awb, options, settings) };
