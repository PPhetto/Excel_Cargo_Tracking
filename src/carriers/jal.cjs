const { trackPublicPage, captureShipmentPreview } = require('./public-tracker.cjs');
const { labeledValue, publishedWeight, publishedVolume } = require('../cargo-totals.cjs');
const { pieceCount } = require('../pieces.cjs');

const prefix = '131';
const name = 'JAL Cargo';
const entry = 'https://prd.jal-ocp.champ.aero/jal-intl-portal/#/pre-login/track-trace/search';
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readMilestones(tables) {
  const groups = tables.map(({ pieces, rows }) => rows.flatMap(({ cells, current, pairedWithNext }, index) => {
    const [, event, airport, flightNumber, , publishedDate, time] = cells;
    const [, day, month, year] = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(publishedDate) || [];
    const monthName = months[Number(month) - 1];
    const timed = Boolean(monthName && Number(day) >= 1 && Number(day) <= 31 &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time));
    if (!event || (!current && !timed)) return [];
    const next = pairedWithNext ? rows[index + 1]?.cells : undefined;
    const flight = [flightNumber, next?.[3]].find(value => /^JL\s*\d{1,4}[A-Z]?$/i.test(value));
    const station = /^[A-Z]{3}$/.test(airport) ? airport : undefined;
    const nextAirport = next?.[2];
    const route = flight && station && /^[A-Z]{3}$/.test(nextAirport) ? station + '-' + nextAirport : undefined;
    const statusDateAsPublished = timed ? [day, monthName, year, time].join(' ') : undefined;
    return [{
      event, station, current, sortKey: timed ? year + month + day + time : '',
      statusDateAsPublished, flightDetailsAsPublished: [flight, route].filter(Boolean).join(' ') || undefined,
      piecesAsPublished: pieceCount(pieces)
    }];
  }).sort((a, b) => Number(b.current) - Number(a.current) || b.sortKey.localeCompare(a.sortKey)));
  const latestByGroup = groups.map(group => group[0]).filter(Boolean);
  const milestones = groups.flat().sort((a, b) => Number(b.current) - Number(a.current) || b.sortKey.localeCompare(a.sortKey))
    .map(({ current, sortKey, ...details }) => details);
  if (latestByGroup.length > 1 && new Set(latestByGroup.map(row => row.event)).size > 1) {
    milestones.unshift({
      event: 'Split shipment',
      descriptionAsPublished: latestByGroup.map(({ piecesAsPublished, event, station }) =>
        [piecesAsPublished == null ? null : piecesAsPublished + ' pcs', event, station].filter(Boolean).join(' ')
      ).join(' / ')
    });
  }
  return milestones;
}

async function track(context, awb, { screenshotPath, captureQuickImage } = {}) {
  return trackPublicPage(context, entry, screenshotPath, async page => {
    const form = page.getByRole('main');
    await form.locator('#awbPrefix').fill(awb.prefix);
    await form.locator('#awbSerial').fill(awb.serial);
    await form.getByRole('button', { name: 'Search', exact: true }).click();

    const label = new RegExp('^Air Waybill Number\\s*:\\s*' + awb.number + '$');
    const header = form.getByRole('tab', { name: label });
    const noRecord = form.getByText(/(?:no (?:matching )?(?:(?:tracing|tracking|shipment) )?(?:data|information|records?|shipments?) (?:was |were )?(?:found|available)|(?:AWB|air waybill|shipment) (?:was )?not found)/i).first();
    const challenge = page.locator('iframe[src*="/recaptcha/api2/bframe"]:visible').first();
    await header.or(noRecord).or(challenge).first().waitFor({ timeout: 30_000 });
    if (await challenge.isVisible()) return { status: 'blocked', message: 'JAL requires human verification.' };
    if (await noRecord.isVisible()) return { status: 'no_record', serialEntered: awb.serial };
    if (await header.getAttribute('aria-expanded') === 'false') await header.click();
    const details = form.getByRole('region', { name: label });
    const summary = await details.innerText();
    const tables = await details.getByRole('table').filter({
      has: page.getByRole('columnheader', { name: 'Milestone', exact: true })
    }).evaluateAll(elements => elements.map(table => {
      const region = table.closest('[role="region"]');
      const caption = region?.ownerDocument.getElementById(region.getAttribute('aria-labelledby'))?.innerText;
      return {
        pieces: /\bPieces:\s*([\d,]+)/i.exec(caption || '')?.[1],
        rows: [...table.tBodies].flatMap(group => [...group.rows]).map(row => ({
          cells: [...row.cells].map(cell => cell.innerText.trim()),
          current: Boolean(row.querySelector('.td-current-status')),
          pairedWithNext: row.classList.contains('no-bottom-border') &&
            Boolean(row.nextElementSibling?.classList.contains('no-top-border'))
        }))
      };
    }));
    const milestones = readMilestones(tables);
    if (!milestones.length) throw new Error('JAL did not publish a confirmed shipment milestone.');
    const quickImage = captureQuickImage ? await captureShipmentPreview(details) : undefined;
    return {
      status: 'tracked', serialEntered: awb.serial, route: {
        origin: labeledValue(summary, 'Origin'), destination: labeledValue(summary, 'Destination')
      },
      totalPieces: pieceCount(labeledValue(summary, 'Total Pieces')),
      totalWeight: publishedWeight(labeledValue(summary, 'Total Weight')),
      totalVolumeCbm: publishedVolume(labeledValue(summary, 'Total Volume')),
      milestones, quickImage
    };
  });
}

module.exports = { prefix, name, track, trackingPage: entry, serialOnly: true, separatePrefix: true, manualOnBlock: true, readMilestones };
