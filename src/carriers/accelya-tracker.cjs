const { trackPublicPage } = require('./public-tracker.cjs');
const { pieceCount } = require('../pieces.cjs');
const { labeledValue, publishedWeight, publishedVolume } = require('../cargo-totals.cjs');

const movementNames = new Map([['DEP', 'Departed'], ['ARR', 'Arrived'], ['RCF', 'Received from flight'], ['DLV', 'Delivered']]);

function readRoute(contents) {
  const airports = [...contents.matchAll(/\(([A-Z]{3})\)/g)].map(match => match[1]);
  return airports.length >= 2 ? { origin: airports[0], destination: airports[1] } : undefined;
}

function cargoTotals(contents) {
  return {
    totalPieces: pieceCount(labeledValue(contents, 'Pieces')),
    totalWeight: publishedWeight(labeledValue(contents, 'Gross Weight')),
    totalVolumeCbm: publishedVolume(labeledValue(contents, 'Volume'))
  };
}

function orderDetailUrl(entry, address) {
  const start = new URL(entry);
  const current = new URL(address);
  if (current.origin === start.origin && current.pathname === start.pathname &&
      !current.username && !current.password && !current.search &&
      /^#\/shipments\/list\/\d+\?openedTab=tracking-details$/.test(current.hash)) {
    return current.href;
  }
}

async function readHistory(timeline, { airline, bookingCode, bookingStatus }) {
  const flightPattern = new RegExp('\\b' + airline + '[-\\s]*(\\d{3,4}),\\s*([^,]+),\\s*([A-Z]{3})-([A-Z]{3})\\b', 'i');
  return (await timeline.evaluateAll(rows => rows.map(row => ({
    code: row.querySelector('.status-code')?.innerText.trim(),
    recordedAt: [...row.querySelectorAll('.achieved-date > p')].map(el => el.innerText.trim()),
    description: row.querySelector('.milestone-description')?.innerText.trim(),
    contents: row.innerText
  })))).filter(row => row.description).map(row => {
    const [stationAndTime, date] = row.recordedAt;
    const station = /^([A-Z]{3}),/.exec(stationAndTime || '')?.[1];
    const time = stationAndTime?.replace(/^[A-Z]{3},\s*|,$/g, '');
    const flight = flightPattern.exec(row.description);
    const pieces = /([\d,]+)\s+Pieces\b/i.exec(row.contents)?.[1];
    const scheduledTime = /\bETD\s+(\d{2}:\d{2})/.exec(row.contents)?.[1];
    const actualDeparture = bookingCode === 'BKD' ? /\bATD\s+(\d{2}:\d{2})/.exec(row.contents)?.[1] : undefined;
    return {
      code: row.code,
      event: movementNames.get(row.code) || row.description,
      station,
      statusDateAsPublished: [date, time].filter(Boolean).join(' '),
      flightDetailsAsPublished: flight && airline + flight[1] + ', ' + flight[2] + ', ' + flight[3] + '-' + flight[4],
      piecesAsPublished: pieces,
      plannedLeg: row.code === bookingCode && flight ? {
        origin: flight[3], destination: flight[4], flight: airline + flight[1],
        departureAsPublished: [flight[2], scheduledTime || actualDeparture].filter(Boolean).join(' '),
        ...(actualDeparture ? { actualDepartureAsPublished: actualDeparture } : {}),
        bookingStatus, pieces: pieceCount(pieces)
      } : undefined
    };
  });
}

async function trackAccelya(context, awb, options, { screenshotPath } = {}) {
  const { entry, carrierLabel, commitWithEnter, cancellation } = options;
  return trackPublicPage(context, entry, screenshotPath, async page => {
    const numberEntered = awb.prefix + awb.serial;
    await page.getByPlaceholder(/Doc\. No\. e\.g\./).fill(numberEntered, { timeout: 40_000 });
    if (commitWithEnter) await page.keyboard.press('Enter');
    await page.getByText(numberEntered, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const matchingAwb = page.getByText('Doc. No.: ' + awb.number, { exact: true });
    const cards = page.locator('accelya-shipment-summary-card:visible').filter({ has: matchingAwb });
    const noRecord = page.getByText(/^(?:Search Results\s*\(0\)|No (?:orders|results|shipments|records)[^.]*found)\.?$/i).first();
    await cards.first().or(noRecord).first().waitFor({ timeout: 45_000 });
    if (await noRecord.isVisible()) return { status: 'no_record', message: await noRecord.innerText() };
    const active = cards.filter({ hasNot: page.getByText(cancellation) });
    if (await active.count() > 1) {
      return { status: 'ambiguous', message: carrierLabel + ' showed multiple active orders for this AWB.' };
    }
    if (!await active.count()) {
      const card = cards.first();
      const route = readRoute(await card.innerText());
      const details = card.getByRole('button', { name: 'Tracking Details', exact: true });
      let totals;
      let shipmentDetailUrl;
      if (await cards.count() === 1) {
        const showDetails = card.getByText('Show Details', { exact: true });
        if (await showDetails.isVisible()) await showDetails.click({ timeout: 5_000 }).catch(() => {});
        totals = cargoTotals(await card.innerText());
      }
      if (totals && await details.isVisible()) {
        try {
          await details.click({ timeout: 5_000 });
          await page.waitForURL(url => Boolean(orderDetailUrl(entry, url)), { timeout: 5_000 });
          await matchingAwb.waitFor({ timeout: 5_000 });
          shipmentDetailUrl = orderDetailUrl(entry, page.url());
        } catch {
          // The matching search card already verifies the cancellation.
        }
      }
      return { status: 'tracked', numberEntered, route, shipmentDetailUrl, ...totals, milestones: [{ event: 'Booking cancelled' }] };
    }
    const route = readRoute(await active.innerText());
    const sourceStatus = await active.locator('.order-status').innerText();
    await active.getByRole('button', { name: 'Tracking Details', exact: true }).click();
    await page.getByRole('heading', { name: 'Milestones', exact: true }).waitFor({ timeout: 30_000 });
    if (!await matchingAwb.isVisible()) throw new Error('The ' + carrierLabel + ' tracking history did not match the requested AWB.');
    const details = page.getByText('Show Details', { exact: true });
    if (await details.isVisible()) await details.click();
    const contents = await page.locator('body').innerText();
    const totals = cargoTotals(contents);
    const timeline = page.locator('li.milestone-item accelya-milestone:visible');
    const history = await readHistory(timeline, options);
    const fallback = sourceStatus.replace(/\s*Tracking Details\s*$/, '').trim();
    if (!history.length && !fallback) throw new Error(carrierLabel + ' did not publish a recognizable shipment status.');
    const legs = history.map(row => row.plannedLeg).filter(Boolean);
    if (options.bookingCode === 'BKD') {
      legs.sort((a, b) => Date.parse(a.departureAsPublished) - Date.parse(b.departureAsPublished));
    }
    return {
      status: 'tracked', numberEntered, route, ...totals, shipmentDetailUrl: orderDetailUrl(entry, page.url()),
      schedule: { legs },
      milestones: history.length ? history.map(({ plannedLeg, ...row }) => row) : [{ event: fallback }]
    };
  });
}

module.exports = { trackAccelya };
