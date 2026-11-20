const { trackPublicPage, dismissCookieBanner } = require('./public-tracker.cjs');
const { pieceCount } = require('../pieces.cjs');
const { labeledValue, publishedWeight, publishedVolume } = require('../cargo-totals.cjs');
const { summarizeDestinationArrival } = require('./singapore-arrival.cjs');

const prefix = '618';
const name = 'Singapore Airlines Cargo';
const entry = 'https://www.siacargo.com/e-services/quicksearch_public/';

function bookingQuantities(contents) {
  const pattern = /([\d,]+)\s+Pieces?\s*\|\s*(SQ\s*\d{3,4})\s*\n\s*DEP ON:\s*([^\n]+)/gi;
  const quantities = new Map();
  for (const [, amount, flight, date] of contents.matchAll(pattern)) {
    const key = bookingKey(flight, date);
    quantities.set(key, quantities.has(key) ? null : pieceCount(amount));
  }
  return quantities;
}

function bookingKey(flight, date) {
  return (flight + date).replace(/\s/g, '').toUpperCase();
}

const movementEvents = new Map([
  ['DEP', 'Departed'], ['DEPARTED', 'Departed'], ['FLIGHT DEPARTED', 'Departed'],
  ['ARR', 'Arrived'], ['ARRIVED', 'Arrived'], ['FLIGHT ARRIVED', 'Arrived'],
  ['RCF', 'Received from flight'], ['RECEIVED FROM FLIGHT', 'Received from flight'],
  ['SHIPMENT CHECKED INTO WAREHOUSE', 'Checked into warehouse'],
  ['NFD', 'Ready for pick-up'], ['SHIPMENT READY FOR PICK-UP', 'Ready for pick-up'],
  ['DLV', 'Delivered'], ['DELIVERED', 'Delivered'], ['SHIPMENT DELIVERED', 'Delivered']
]);

async function movementMilestones(page) {
  const table = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: 'MILESTONE', exact: true })
  });
  const more = page.getByText('MORE DETAILS', { exact: true });
  if (!(await table.count()) && await more.isVisible()) await more.click({ timeout: 3_000 });
  const rows = await table.getByRole('row').evaluateAll(elements =>
    elements.map(row => [...row.cells].map(cell => cell.innerText.trim())));
  const header = rows.find(row => row.includes('MILESTONE') && row.includes('PIECES'));
  if (!header) return [];
  const eventFor = row => movementEvents.get(row[header.indexOf('MILESTONE')]?.replace(/\s+/g, ' ').toUpperCase());
  return rows.filter(row => row.length >= header.length && eventFor(row))
    .map(row => ({
      event: eventFor(row),
      station: row[header.indexOf('STATION')],
      statusDateAsPublished: row[header.indexOf('DATE | TIME')],
      flightDetailsAsPublished: row[header.indexOf('FLIGHT DETAILS')],
      piecesAsPublished: row[header.indexOf('PIECES')]
    }));
}

function reconcileStatus(code, lastUpdated, legs, movements, destinationArrival) {
  const isBooked = /^BKD$/i.test(code);
  const carrierSummary = {
    event: isBooked ? 'Booked (BKD)' : code,
    statusDateAsPublished: lastUpdated,
    station: null
  };
  const cancelled = legs.filter(leg => /^cancell?ed$/i.test(leg.bookingStatus)).length;
  const bookingCancellation = cancelled === 0 ? null : cancelled === legs.length ? 'all' : 'some';
  let latest = carrierSummary;
  if (destinationArrival && !/^(?:DLV|Delivered)$/i.test(code) && !movements.some(event =>
    event.event === 'Delivered' && event.station === destinationArrival.destination
  )) {
    const { arrived, total, destination, latestArrivalAsPublished } = destinationArrival;
    latest = {
      event: arrived + '/' + total + ' pieces arrived at ' + destination,
      statusDateAsPublished: latestArrivalAsPublished,
      station: null
    };
  } else if (isBooked && movements.length) {
    latest = movements.length === 1 ? movements[0] : { event: 'Cargo movement recorded' };
  } else if (isBooked && bookingCancellation) {
    latest = { event: bookingCancellation === 'all' ? 'Booking cancelled' : 'Booked · cancellation reported' };
  } else if (isBooked && !legs.length) {
    latest = { ...carrierSummary, event: 'Booked (summary only)' };
  }
  return {
    carrierSummary,
    bookingCancellation,
    milestones: [latest, ...movements.filter(event => event !== latest)]
  };
}

async function track(context, awb, { screenshotPath } = {}) {
  return trackPublicPage(context, entry, screenshotPath, async page => {
    await dismissCookieBanner(page, 'Accept All');
    const input = page.locator('#sqpp-tracking-quicksearch-awbfield-id');
    await input.waitFor();
    const clearAll = page.getByRole('button', { name: 'CLEAR ALL', exact: true });
    if (await clearAll.isVisible()) {
      await clearAll.click();
      await clearAll.waitFor({ state: 'hidden' });
    }
    const numberEntered = awb.prefix + awb.serial;
    await input.fill(numberEntered);
    const trackButton = page.getByRole('button', { name: 'TRACK', exact: true });
    await trackButton.click();
    const result = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: awb.number, exact: true })
    });
    await result.waitFor({ timeout: 65_000 });
    const values = await result.getByRole('cell').allInnerTexts();
    const labels = await result.locator('xpath=ancestor::table[1]').getByRole('row')
      .filter({ hasText: /LAST STATUS/ }).first().locator('th,td').allInnerTexts();
    const fields = Object.fromEntries(labels.map((label, index) => [label.trim(), values[index]?.trim()]));
    if (fields['AWB NO.'] !== awb.number || !fields['LAST STATUS'] || !fields['LAST UPDATED']) {
      throw new Error('The matching Singapore Airlines row lacked a recognizable status.');
    }
    const code = fields['LAST STATUS'];
    const schedule = {
      flight: fields['FLIGHT NO.'],
      dateAsPublished: fields['FLIGHT DATE']
    };
    let totalPieces = null;
    let totalWeight;
    let totalVolumeCbm;
    let movements = [];
    // The summary names the final leg. The details show the originating flight too.
    try {
      await result.getByText(awb.number, { exact: true }).click({ timeout: 5_000 });
      const legTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'UPLIFT POINT' }) });
      await legTable.waitFor({ timeout: 10_000 });
      const contents = (await page.locator('body').innerText()).split(/\bCURRENT SHIPMENT STATUS\b/i)[0];
      const summary = contents.split(/\bBOOKING (?:INFORMATION|STATUS)\b/i)[0];
      totalPieces = pieceCount(labeledValue(summary, 'Total pieces'));
      totalWeight = publishedWeight(labeledValue(summary, 'Total weight'));
      totalVolumeCbm = publishedVolume(labeledValue(summary, 'Total volume') ?? labeledValue(summary, 'Volume'));
      const quantities = bookingQuantities(contents);
      const legs = await legTable.getByRole('row').evaluateAll(rows => rows.slice(1)
        .map(row => [...row.cells].map(cell => cell.innerText.trim())));
      schedule.legs = legs.filter(row => row.length === 6).map(
        ([origin, destination, flight, departureAsPublished, arrivalAsPublished, bookingStatus]) => ({
          origin, destination, flight, departureAsPublished, arrivalAsPublished, bookingStatus,
          pieces: quantities.get(bookingKey(flight, departureAsPublished)) ?? null
        })
      );
      movements = await movementMilestones(page);
    } catch {
      // Retain the verified summary if the optional booking details do not load.
    }
    const destinationArrival = summarizeDestinationArrival(fields.DESTINATION, totalPieces, movements);
    return {
      status: 'tracked',
      route: { origin: fields.ORIGIN, destination: fields.DESTINATION },
      totalPieces,
      totalWeight,
      totalVolumeCbm,
      numberEntered,
      schedule,
      destinationArrival,
      ...reconcileStatus(code, fields['LAST UPDATED'], schedule.legs || [], movements, destinationArrival)
    };
  });
}

module.exports = { prefix, name, track, reconcileStatus, trackingPage: entry };
