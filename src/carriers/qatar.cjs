const { trackPublicPage, dismissCookieBanner } = require('./public-tracker.cjs');
const { pieceCount } = require('../pieces.cjs');
const { publishedWeight, publishedVolume } = require('../cargo-totals.cjs');

const prefix = '157';
const name = 'Qatar Airways Cargo';
const entry = 'https://www.qrcargo.com/s/track-your-shipment';

async function track(context, awb, { screenshotPath } = {}) {
  return trackPublicPage(context, entry, screenshotPath, async page => {
    const consent = page.getByRole('button', { name: 'Yes, got it.', exact: true });
    await consent.waitFor({ timeout: 20_000 }).catch(() => {});
    await dismissCookieBanner(page, 'Yes, got it.');
    await page.getByRole('link', { name: 'Products', exact: true }).first().waitFor();
    const formPrefix = page.locator('input[data-id="docprefix"]');
    if (await formPrefix.inputValue() !== awb.prefix) throw new Error('Qatar did not show the expected MAWB prefix.');
    await page.locator('input[data-id="docawb"]').pressSequentially(awb.serial);
    await page.getByRole('button', { name: 'Track Shipment(s)', exact: true }).click();
    const summary = page.locator('ul.sel-awb:visible').filter({
      has: page.getByText(new RegExp('^' + awb.number + '\\s+\\('))
    });
    const noRecord = page.getByText(/^(?:No (?:shipment|tracking|record|data|result)[^.]*found|AWB not found)\.?$/i).first();
    await summary.or(noRecord).first().waitFor({ timeout: 55_000 });
    if (await noRecord.isVisible()) return { status: 'no_record', message: await noRecord.innerText() };
    const shipment = await summary.innerText();
    const route = /\(([A-Z]{3})\s*-\s*([A-Z]{3})\)/.exec(shipment);
    const [pieceLabel, ...measurements] = shipment.split('\n').find(line => /\bPiece\(s\)/i.test(line))?.split('|') || [];
    const count = /([\d,]+)\s+Piece\(s\)/i.exec(pieceLabel)?.[1];
    const timeline = page.locator('ul.qrds-cargo-track-details:visible');
    await timeline.first().waitFor();
    const milestones = (await timeline.evaluateAll(rows => rows.map(row => {
      const [, details, time] = row.children;
      return [
        details?.querySelector('ul > li')?.innerText.trim(),
        details?.innerText,
        [...(time?.querySelectorAll('ul > li') || [])].map(cell => cell.innerText.trim()).join(' ')
      ];
    }))).filter(([event, , time]) => event && time).map(([description, details, statusDateAsPublished]) => {
      const movement = /^(Departed from|Arrived in|Delivered in|Received in)\s+([A-Z]{3})\b/i.exec(description);
      const flight = /\b(QR\s*\d{3,4})\/(\d{1,2}-[A-Z]{3}-\d{4})\b/i.exec(description);
      return {
        event: movement ? movement[1].split(' ')[0] : description,
        station: movement?.[2],
        statusDateAsPublished,
        flightDetailsAsPublished: flight && flight[1].replace(/\s/g, '') + ' ' + flight[2].replaceAll('-', ' '),
        piecesAsPublished: /([\d,]+)\s+Pcs\b/i.exec(details)?.[1]
      };
    });
    if (!milestones.length) throw new Error('Qatar showed the matching AWB without a readable timeline.');
    return {
      status: 'tracked',
      serialEntered: awb.serial,
      route: route && { origin: route[1], destination: route[2] },
      totalPieces: pieceCount(count),
      totalWeight: measurements.map(publishedWeight).find(Boolean),
      totalVolumeCbm: measurements.map(publishedVolume).find(Boolean),
      milestones
    };
  });
}

module.exports = { prefix, name, track, trackingPage: entry, serialOnly: true };
