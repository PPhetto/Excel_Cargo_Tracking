const { basename, dirname, join } = require('node:path');
const { pieceCount } = require('../pieces.cjs');
const { publishedWeight, publishedVolume } = require('../cargo-totals.cjs');

const prefix = '217';
const name = 'Thai Airways Cargo';
const entry = 'https://chorus.thaicargo.com/skychain/app';
const publicForm = `${entry}?service=page%2Fnwp%3ATrackshipmt`;
const timeout = 15_000;
const milestoneHeaders = ['Station', 'Status Date', 'Status', 'Flight Details', 'Pieces', 'Weight'];

async function readShipment(page, awb) {
  const summary = page.locator('tr.grdRow:visible').filter({
    has: page.getByRole('cell', { name: awb.number, exact: true })
  });
  if (await summary.count() !== 1) return { milestones: [] };

  const summaryCells = await summary.locator(':scope > td').allInnerTexts();
  if (summaryCells[1]?.trim() !== awb.number) return { milestones: [] };
  const route = { origin: summaryCells[2]?.trim(), destination: summaryCells[3]?.trim() };
  const totals = {
    totalPieces: pieceCount(summaryCells[4]),
    totalWeight: publishedWeight(summaryCells[5]),
    totalVolumeCbm: publishedVolume(summaryCells[6])
  };

  const tables = summary.locator('xpath=following-sibling::tr[1]').locator('table:visible');
  const statusTable = tables.filter({
    has: page.getByRole('columnheader', { name: 'Status Date', exact: true })
  });
  if (!(await statusTable.count())) {
    const expand = summary.locator('a:visible').filter({ has: page.locator('img[src$="ico_plus.gif"]') });
    if (await expand.count() === 1) await expand.click();
  }
  if (await statusTable.count() !== 1) return { route, ...totals, milestones: [] };

  const rows = await statusTable.locator('tr:visible').evaluateAll(elements => elements.map(row =>
    Array.from(row.cells, cell => cell.innerText.trim())
  ));
  const [headers, ...data] = rows;
  if (JSON.stringify(headers) !== JSON.stringify(milestoneHeaders)) return { route, ...totals, milestones: [] };

  const milestones = data.filter(row => row.length === milestoneHeaders.length && row[0] && row[1] && row[2])
    .map(([station, statusDate, event, flightDetails, pieces, weight]) => ({
      event,
      station,
      statusDateAsPublished: statusDate,
      flightDetailsAsPublished: flightDetails === '-' ? null : flightDetails,
      piecesAsPublished: pieces || null,
      weightAsPublished: weight || null
    }));
  return { route, ...totals, milestones };
}

async function track(context, awb, { screenshotPath } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const diagnostics = { documents: [], scripts: [], pageErrors: [], dialogs: [] };
  let milestones = [];
  let stage = 'entry';
  let status = 'unverified';
  let message;
  let serialEntered;
  let route;
  let totalPieces;
  let totalWeight;
  let totalVolumeCbm;

  page.on('response', response => {
    const request = response.request();
    const url = new URL(response.url());
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) {
      diagnostics.documents.push({ method: request.method(), httpStatus: response.status(), path: url.pathname });
    }
    if (request.resourceType() === 'script' && response.status() >= 400) {
      diagnostics.scripts.push({ path: url.pathname, httpStatus: response.status() });
    }
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  page.on('dialog', async dialog => {
    diagnostics.dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'beforeunload') {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  async function checkPage(response) {
    const title = await page.title();
    const challenged = /^(just a moment|attention required|access denied|forbidden|verify (?:that )?you are human)\b/i.test(title) ||
      await page.locator('iframe[src*="challenges.cloudflare.com"]:visible, iframe[src*="recaptcha"]:visible').count();
    const denied = diagnostics.documents.find(doc => [401, 403, 429].includes(doc.httpStatus));
    if (challenged || denied) {
      status = 'blocked';
      throw new Error(denied ? `Tracking access stopped at HTTP ${denied.httpStatus}.` : 'A browser challenge was visible.');
    }
    const httpStatus = response?.status() ?? diagnostics.documents.at(-1)?.httpStatus;
    if (httpStatus >= 400) {
      status = 'site_error';
      throw new Error(`The site returned HTTP ${httpStatus}.`);
    }
    if (new URL(page.url()).origin !== new URL(entry).origin) {
      throw new Error('The tracking page left the CHORUS origin.');
    }
  }

  try {
    const first = await page.goto(entry, { waitUntil: 'load', timeout });
    await checkPage(first);
    stage = 'public_form';
    const form = await page.goto(publicForm, { waitUntil: 'load', timeout });
    await checkPage(form);
    const number = page.locator('input[name="txtNumber"]:visible');
    if (await page.locator('input[name="txtPrefix"]:visible').inputValue() !== awb.prefix ||
        await page.locator('input[name="selectDoctype"]:visible').inputValue() !== 'AWB') {
      throw new Error('The carrier form did not present the expected AWB document type and prefix.');
    }
    const view = page.locator('input[name="trackView"]:checked');
    await view.waitFor({ state: 'visible' });
    if (await view.inputValue() !== 'tableRadio') {
      await page.locator('input[name="trackView"][value="tableRadio"]').check();
    }
    await number.fill(awb.serial);
    serialEntered = await number.inputValue();
    if (serialEntered !== awb.serial) throw new Error('The form did not preserve the supplied serial.');

    stage = 'track_click';
    const documentsBeforeClick = diagnostics.documents.length;
    const dialogsBeforeClick = diagnostics.dialogs.length;
    const navigation = page.waitForEvent('framenavigated', {
      predicate: frame => frame === page.mainFrame(),
      timeout
    }).then(() => true, () => false);
    await page.getByRole('button', { name: 'Track', exact: true }).click();
    diagnostics.trackClicked = true;
    const navigated = await navigation;
    await page.waitForLoadState('load', { timeout });
    await checkPage(null);

    stage = 'result';
    diagnostics.documentsAfterClick = diagnostics.documents.length - documentsBeforeClick;
    if (navigated && await number.isVisible()) {
      await view.waitFor({ state: 'visible' });
    }
    const pageText = await page.locator('body').innerText();
    const noRecord = /(?:no (?:matching )?(?:shipments?|tracking records?) (?:found|available)|(?:shipment|air waybill|awb) (?:was )?not found)/i.exec(pageText);
    if (diagnostics.dialogs.slice(dialogsBeforeClick).some(dialog => dialog.type !== 'beforeunload')) {
      message = 'The carrier showed a dialog after the Track click. See diagnostics.';
    } else if (noRecord) {
      status = 'no_record';
      message = noRecord[0];
    } else if (!navigated && diagnostics.documentsAfterClick === 0 && await number.isVisible() &&
               await number.inputValue() === awb.serial && /Track the current status of your shipment/i.test(pageText)) {
      status = 'no_response';
      message = 'Track was clicked. The same public form remained visible and no result page opened.';
    } else {
      ({ route, totalPieces, totalWeight, totalVolumeCbm, milestones } = await readShipment(page, awb));
      if (milestones.length) {
        status = 'tracked';
        message = 'Read dated tracking rows from the visible carrier page.';
      } else {
        message = route
          ? 'The matching shipment was visible, but its milestone table was unavailable or had an unfamiliar layout.'
          : 'The response did not expose a unique matching shipment row.';
      }
    }
  } catch (error) {
    message = error.message.split('\n')[0];
  }

  let screenshot;
  if (screenshotPath) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 });
      screenshot = join(basename(dirname(screenshotPath)), basename(screenshotPath)).replaceAll('\\', '/');
    } catch (error) {
      diagnostics.screenshotError = error.message.split('\n')[0];
    }
  }
  const finalUrl = page.url();
  return {
    status, stage, message, serialEntered, source: { entry, publicForm, finalUrl, title: await page.title().catch(() => '') },
    route, totalPieces, totalWeight, totalVolumeCbm, milestones, diagnostics, screenshot
  };
}

module.exports = { prefix, name, track, trackingPage: publicForm, serialOnly: true };
