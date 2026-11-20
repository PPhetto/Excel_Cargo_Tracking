const { trackPublicPage, captureShipmentPreview } = require('./public-tracker.cjs');
const { pieceCount } = require('../pieces.cjs');
const { publishedWeight, publishedVolume } = require('../cargo-totals.cjs');

const activityNames = new Map([
  ['DLV', 'Delivered'], ['ARR', 'Arrived'], ['DEP', 'Departed'],
  ['NFD', 'Consignee notified'], ['RCS', 'Accepted'], ['BKD', 'Booked']
]);

async function trackIcargo(context, awb, { entry, name, airline, preview, openShipment }, { screenshotPath, captureQuickImage } = {}) {
  const flightPattern = new RegExp('\\b' + airline + '[-\\s]*(\\d{3,4})\\s*,\\s*(\\d{1,2}\\s+[A-Z]{3}\\s+\\d{4}(?:\\s+\\d{2}:\\d{2}\\s*\\([AS]\\))?)', 'i');
  return trackPublicPage(context, entry, screenshotPath, async (searchPage, useResultPage) => {
    const numberEntered = openShipment ? awb.serial : awb.prefix + awb.serial;
    const page = openShipment ? await openShipment(searchPage, awb, useResultPage) : searchPage;
    if (!openShipment) {
      const input = page.getByPlaceholder('Enter the AWB Number', { exact: true });
      await input.fill(numberEntered, { timeout: 35_000 });
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    const number = page.getByTestId('navigation-panel__curr-awb-label').filter({
      hasText: new RegExp('^' + awb.number + '$')
    });
    const noRecord = page.getByText(/^(?:No (?:shipment|tracking|record|data|result)[^.]*found|AWB not found)\.?$/i).first();
    await number.or(noRecord).first().waitFor({ timeout: 40_000 });
    if (await noRecord.isVisible()) return { status: 'no_record', message: await noRecord.innerText() };

    await page.getByTestId('tabs-panel__tab-activityView').click();
    const history = page.getByTestId('shipment_activity').locator('[data-testid^="shipment_activity_item-"]:visible');
    await history.first().waitFor({ timeout: 40_000 });

    const totalPieces = pieceCount(await page.getByTestId('pieces').innerText());
    const weight = page.getByTestId('shipment-measurements-panel__weight-value');
    const volume = page.getByTestId('shipment-measurements-panel__measure-value');
    const totalWeight = await weight.isVisible() ? publishedWeight(await weight.textContent()) : undefined;
    const totalVolumeCbm = await volume.isVisible() ? publishedVolume(await volume.textContent()) : undefined;
    const airports = (await page.locator('div[class*="milestone-point__circle"] > span:visible').allInnerTexts())
      .map(text => text.trim()).filter(text => /^[A-Z]{3}$/.test(text));
    const route = airports.length >= 2 ? { origin: airports[0], destination: airports.at(-1) } : undefined;
    const records = await history.evaluateAll(rows => rows.map(row => {
      const context = row.nextElementSibling;
      const [station, , recordedAt] = [...(context?.querySelectorAll('p') || [])].map(el => el.innerText.trim());
      return {
        code: row.getAttribute('data-testid').replace('shipment_activity_item-', ''),
        label: row.querySelector('[class*="timeline__label-text"]')?.textContent.trim(),
        description: row.querySelector('[class*="timeline__title-lg"]')?.textContent.replace(/\s+/g, ' ').trim(),
        station,
        recordedAt
      };
    }));
    const milestones = records.filter(row => row.description && row.recordedAt).map(row => {
      const flight = flightPattern.exec(row.description);
      return {
        code: row.code,
        event: activityNames.get(row.code) || row.label || row.description,
        station: row.station,
        statusDateAsPublished: row.recordedAt,
        flightDetailsAsPublished: flight && airline + flight[1] + ', ' + flight[2],
        piecesAsPublished: /(-?[\d,]+)\s+pcs\b/i.exec(row.description)?.[1],
        descriptionAsPublished: row.description
      };
    });
    if (!milestones.length) throw new Error(name + ' showed no readable events in Activity View.');
    const quickImage = preview && captureQuickImage
      ? await captureShipmentPreview(page.getByRole('article').filter({ has: number })) : undefined;
    return { status: 'tracked', numberEntered, route, totalPieces, totalWeight, totalVolumeCbm, milestones, quickImage };
  });
}

module.exports = { trackIcargo };
