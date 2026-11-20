const { dismissCookieBanner, trackPublicPage } = require('./public-tracker.cjs');
const { pieceCount } = require('../pieces.cjs');
const { publishedWeight, publishedVolume } = require('../cargo-totals.cjs');

const prefix = '235';
const name = 'Turkish Cargo';
const entry = 'https://www.turkishcargo.com/en/cargo-tracking';

function manualTrackingUrl(awb) {
  const url = new URL(entry);
  url.searchParams.set('awbPrefix', prefix);
  url.searchParams.set('awbNumber', awb.serial);
  return url.href;
}

async function readRows(table) {
  const pagination = table.locator('xpath=ancestor::*[.//button[@aria-label="Go to next page"]][1]');
  const next = pagination.getByRole('button', { name: 'Go to next page', exact: true });
  const rows = [];
  for (;;) {
    rows.push(...await table.evaluate(element => {
      const headers = [...element.tHead.rows[0].cells].map(cell => cell.innerText.trim());
      return [...element.tBodies].flatMap(body => [...body.rows].map(row =>
        Object.fromEntries([...row.cells].map((cell, index) =>
          [headers[index], cell.innerText.trim() || cell.querySelector('img')?.alt || '']
        ))
      ));
    }));
    if (!await next.count() || !await next.isEnabled()) return rows;
    const current = pagination.locator('button[aria-current="page"]');
    const nextPage = Number(await current.innerText()) + 1;
    await next.click();
    await current.filter({ hasText: new RegExp('^' + nextPage + '$') }).waitFor();
  }
}

function timeValue(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  // The carrier displays station-local times. Order the displayed timestamps.
  return Date.UTC(year, month - 1, day, hour, minute);
}

function parseResult(summary, history, reservations) {
  const route = {
    origin: /\bFrom\s+([A-Z]{3})\b/.exec(summary)?.[1],
    destination: /\bTo\s+([A-Z]{3})\b/.exec(summary)?.[1]
  };
  const shipment = summary.split(/^\s*From\s*$/im)[0].split('\n');
  const totalPieces = pieceCount(shipment.map(line => /^([\d,]+)\s+piece\(s\)$/i.exec(line.trim())?.[1]).find(Boolean));
  const totalWeight = shipment.map(publishedWeight).find(Boolean);
  const totalVolumeCbm = shipment.map(publishedVolume).find(Boolean);
  const legs = reservations.flatMap(row => {
    const segment = /^([A-Z]{3})\s*-\s*([A-Z]{3})$/.exec(row.Segment);
    if (!segment || !row['Flight No']) return [];
    return [{
      origin: segment[1], destination: segment[2], flight: row['Flight No'],
      departureAsPublished: row.ETD, arrivalAsPublished: row.ETA,
      pieces: pieceCount(row['Pieces/Weight']?.split('/')[0]),
      bookingStatus: /^check icon$/i.test(row['Approval Status']) ? 'Confirmed' : row['Approval Status']
    }];
  });
  const milestones = history.flatMap(row => {
    const time = timeValue(row['Actual time']);
    if (time === null || !row.Description || !row.Station) return [];
    const flight = /^TK\s*\d{3,4}$/i.test(row['Flight no']) ? row['Flight no'] : null;
    const scheduledDate = /^\d{2}\.\d{2}\.\d{4}\b/.exec(row.ETD)?.[0];
    return [{
      time, code: row.Status,
      event: row.Status === 'DEP' ? 'Departed' : row.Description,
      station: row.Station, statusDateAsPublished: row['Actual time'],
      flightDetailsAsPublished: flight && [flight, scheduledDate].filter(Boolean).join(' '),
      piecesAsPublished: row['Actual pieces / weight']?.split('/')[0].trim()
    }];
  }).sort((a, b) => b.time - a.time).map(({ time, ...event }) => event);
  if (!milestones.length || !route.origin || !route.destination) {
    throw new Error('Turkish Cargo showed no readable shipment history or route.');
  }
  return { status: 'tracked', route, totalPieces, totalWeight, totalVolumeCbm, schedule: { legs }, milestones };
}

async function track(context, awb, { screenshotPath } = {}) {
  return trackPublicPage(context, entry, screenshotPath, async page => {
    const gate = page.locator('#px-captcha-modal:visible, #px-captcha-wrapper:visible, #px-captcha:visible')
      .or(page.getByText(/Press & Hold to confirm you are a human/i).filter({ visible: true })).first();
    const blocked = { status: 'blocked', message: 'Turkish Cargo requires human verification.' };
    const input = page.getByRole('combobox', { name: /AWB no/i }).filter({ visible: true });
    const noRecord = page.getByText(/^(?:No (?:shipment|tracking|record|data|result)[^.]*found|AWB not found)\.?$/i)
      .filter({ visible: true }).first();
    const details = page.locator('#tracking-details:visible').filter({ has: page.getByText(awb.number, { exact: true }) });
    const history = details.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Actual time', exact: true }) });
    try {
      await input.or(gate).first().waitFor();
      if (await gate.isVisible()) return blocked;
      await dismissCookieBanner(page, 'Accept all');
      const displayedPrefix = await page.getByRole('textbox', { name: /AWB prefix/i }).inputValue();
      if (displayedPrefix !== prefix) throw new Error('Turkish Cargo did not show the expected 235 prefix.');
      await input.fill(awb.serial);
      await input.press('Enter');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await history.or(noRecord).or(gate).first().waitFor({ timeout: 35_000 });
      if (await gate.isVisible()) return blocked;
      if (await noRecord.isVisible()) return { status: 'no_record', message: await noRecord.innerText() };
      const reservations = page.getByRole('table').filter({
        has: page.getByRole('columnheader', { name: 'Approval Status', exact: true })
      });
      const summary = await details.innerText();
      const rows = await readRows(history);
      const bookings = await reservations.count() === 1 ? await readRows(reservations) : [];
      return { ...parseResult(summary, rows, bookings), numberEntered: awb.serial };
    } catch (error) {
      if (await gate.isVisible().catch(() => false)) return blocked;
      throw error;
    }
  });
}

module.exports = { prefix, name, track, trackingPage: entry, manualTrackingUrl, parseResult };
