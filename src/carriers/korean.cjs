const { trackPublicPage, dismissCookieBanner, captureShipmentPreview } = require('./public-tracker.cjs');
const { pieceCount } = require('../pieces.cjs');
const { labeledValue, publishedWeight, publishedVolume } = require('../cargo-totals.cjs');

const prefix = '180';
const name = 'Korean Air Cargo';
const entry = 'https://cargo.koreanair.com/tracking';

function readMilestones(resultText) {
  const history = /(?:^|\n)Cargo Status[^\n]*\n([\s\S]*?)(?:\nReservation Information|\nView Less|$)/.exec(resultText)?.[1];
  if (!history) return [];
  const events = [];
  let station;
  let details = [];
  for (const line of history.split('\n').map(line => line.trim()).filter(Boolean)) {
    if (/^[A-Z]{3}$/.test(line)) {
      station = line;
      details = [];
      continue;
    }
    const event = /^(.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2})\s*(\d{2}:\d{2})$/.exec(line);
    if (!event || !station) {
      details.push(line);
      continue;
    }
    const published = details.join(' ');
    const record = {
      event: event[1],
      station,
      statusDateAsPublished: event[2] + ' ' + event[3],
      flightDetailsAsPublished: published.match(/\bKE\s?\d{3,4}\b/g)?.join(', ') || null,
      piecesAsPublished: published.match(/\b[\d,]+\s+pcs\b/)?.[0] || null
    };
    if (!events.some(previous => Object.keys(record).every(key => previous[key] === record[key]))) {
      events.push(record);
    }
  }
  return events.reverse();
}

function readBookings(contents) {
  const reservations = contents.split(/\nReservation Information\s*\n/)[1] || '';
  const heading = /^(KE[ \t]*\d{3,4})[ \t]*\|[ \t]*([A-Z]{3})[ \t]*-[ \t]*([A-Z]{3})[ \t]*\|[ \t]*([\d,]+)[ \t]+pcs[^\n]*?(Confirmed)[ \t]*$/gm;
  const matches = [...reservations.matchAll(heading)];
  return matches.map(([, flight, origin, destination, amount, bookingStatus], index) => {
    const details = reservations.slice(matches[index].index, matches[index + 1]?.index ?? reservations.length);
    return {
      origin, destination, flight, bookingStatus, pieces: pieceCount(amount),
      departureAsPublished: /^STD\s+(.+)$/m.exec(details)?.[1],
      actualDepartureAsPublished: /^ATD\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2}:\d{2})$/m.exec(details)?.[1]
    };
  });
}

async function track(context, awb, { screenshotPath, captureQuickImage } = {}) {
  return trackPublicPage(context, entry, screenshotPath, async page => {
    const form = page.getByLabel('master awb tracking');
    const serial = form.locator('#awbDocNo1');
    const button = form.getByRole('button', { name: 'Track', exact: true });
    const sessionExpired = page.getByText(/Session Expired/i);
    const tab = page.getByRole('tab').filter({ hasText: new RegExp(awb.prefix + '\\s+' + awb.serial + '\\b') }).first();
    const noRecord = page.getByText(/No (?:tracking data|shipment data|result|record)s? found|AWB not found/i).first();

    async function submit() {
      await dismissCookieBanner(page, 'Accept');
      if (await form.locator('#awbPrefix1').inputValue() !== awb.prefix) {
        throw new Error('The tracking form did not show the Korean Air prefix.');
      }
      await serial.fill(awb.serial);
      await button.click();
      await tab.or(sessionExpired).or(noRecord).first().waitFor();
    }
    await submit();
    if (await sessionExpired.isVisible()) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await submit();
      if (await sessionExpired.isVisible()) throw new Error('Korean Air could not renew the tracking session.');
    }
    if (await noRecord.isVisible()) return { status: 'no_record', message: await noRecord.innerText() };

    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) throw new Error('The matching Korean Air shipment had no details panel.');
    const panel = page.locator('[role="tabpanel"]').and(page.locator('[id=' + JSON.stringify(panelId) + ']'));
    const more = panel.getByRole('link', { name: 'View All', exact: true });
    if (await more.isVisible()) {
      await more.press('Enter');
      await panel.getByRole('link', { name: 'View Less', exact: true }).waitFor();
    }
    const contents = await panel.innerText();
    const routeText = /^Routing\s*\n([A-Z]{3}(?:-[A-Z]{3})+)$/m.exec(contents)?.[1];
    const airports = routeText?.split('-');
    const milestones = readMilestones(contents);
    if (!milestones.length) throw new Error('The matching Korean Air shipment had no readable history.');

    const quickImage = captureQuickImage ? await captureShipmentPreview(panel) : undefined;
    const [pieces, weight] = labeledValue(contents, 'Pieces/Weight')?.split('/') || [];
    const summary = contents.split(/^[ \t]*Cargo Status/m)[0];
    return {
      status: 'tracked',
      route: airports && { origin: airports[0], destination: airports.at(-1), via: airports.slice(1, -1) },
      totalPieces: pieceCount(pieces),
      totalWeight: publishedWeight(weight),
      totalVolumeCbm: publishedVolume(labeledValue(summary, 'Volume')),
      schedule: { legs: readBookings(contents) },
      serialEntered: awb.serial,
      milestones,
      quickImage
    };
  });
}

module.exports = { prefix, name, track, trackingPage: entry, serialOnly: true };
