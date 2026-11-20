'use strict';

const form = document.querySelector('#track');
const submit = form.querySelector('button');
const progress = document.querySelector('#progress');
const table = document.querySelector('#results');
const body = table.querySelector('tbody');
const cacheKey = 'excel-group-cargo.last-verified.v1';
const imageDialog = document.querySelector('#quick-image');
const imageTitle = document.querySelector('#quick-image-title');
const imageTime = document.querySelector('#quick-image-time');
const imagePreview = imageDialog.querySelector('img');
const imageUrls = new Set();
let activeRequest;

function clearQuickImages() {
  imageDialog.close();
  imagePreview.removeAttribute('src');
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
  body.querySelectorAll('.quick-image-link').forEach(button => button.remove());
}

imageDialog.addEventListener('close', () => {
  if (!imageDialog.open) imagePreview.removeAttribute('src');
});
window.addEventListener('pagehide', () => {
  activeRequest?.abort();
  clearQuickImages();
});

function parseList(input) {
  const rows = [];
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    const cleaned = line.trim().replace(/^\||\|$/g, '').trim();
    if (!cleaned || /^\s*AWB\b/i.test(cleaned) || /^[|:\s-]+$/.test(cleaned)) continue;
    const match = /^(\d{3})[ \t]*-?[ \t]*(\d(?:[ \u00a0]*\d){7})(?=$|[|\t, \u00a0])(.*)$/.exec(cleaned);
    if (!match) throw new Error('Check the AWB on line ' + (index + 1) + '.');
    if (!['098', '105', '131', '157', '176', '180', '205', '217', '235', '297', '618'].includes(match[1])) {
      throw new Error('Unsupported airline prefix on line ' + (index + 1) + '.');
    }
    const awb = match[1] + '-' + match[2].replace(/\s/g, '');
    const shipper = match[3].replace(/^\s*[|,]/, '').trim();
    rows.push({ awb, shipper });
  }
  if (!rows.length || rows.length > 50) throw new Error('Enter between 1 and 50 AWBs.');
  return rows;
}

function getCache() {
  try {
    return new Map(JSON.parse(localStorage.getItem(cacheKey) || '[]'));
  } catch {
    return new Map();
  }
}

function saveCache(result) {
  const cache = getCache();
  cache.delete(result.awb);
  cache.set(result.awb, result);
  try {
    localStorage.setItem(cacheKey, JSON.stringify([...cache].slice(-250)));
  } catch {
    // The live result stays available if browser storage is full or disabled.
  }
}

function setText(cell, text, detail, failed = false) {
  cell.textContent = text;
  cell.classList.toggle('failed', failed);
  if (detail) {
    const line = document.createElement('span');
    line.className = 'detail';
    line.textContent = detail;
    cell.append(line);
  }
}

function checkedTime(value) {
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function renderShipmentDetail(cell, awb, detail, quickImage) {
  const link = document.createElement('a');
  link.className = 'shipment-detail-link';
  link.href = detail?.url || '/shipment-detail/' + awb;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Track shipment detail';
  cell.replaceChildren(link);
  if (quickImage) {
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'quick-image-link';
    view.textContent = 'View quick image';
    view.addEventListener('click', () => {
      imageTitle.textContent = [awb, quickImage.carrier].filter(Boolean).join(' · ');
      imageTime.textContent = 'Captured ' + checkedTime(quickImage.capturedAt);
      imagePreview.alt = quickImage.carrier
        ? 'Captured ' + quickImage.carrier + ' shipment details' : 'Captured shipment details';
      imagePreview.src = quickImage.url;
      imageDialog.showModal();
    });
    cell.append(view);
  }
  if (detail?.searchNumber) {
    const hint = document.createElement('span');
    hint.className = 'detail shipment-detail-number';
    hint.textContent = 'Enter ' + [detail.searchPrefix, detail.searchNumber].filter(Boolean).join(' and ');
    cell.append(hint);
  }
}

function renderPieces(cell, tracking) {
  const summary = [];
  if (tracking?.total != null) summary.push(tracking.total + ' total');
  if (tracking?.originDeparted != null) summary.push(tracking.originDeparted + ' departed ' + tracking.origin);
  const flights = tracking?.flights || [];
  cell.textContent = summary.join(' · ') || (flights.length ? 'Total not shown' : '—');
  const labels = { departed: 'Departed', booked: 'Booked', 'booking reported': 'Booking shown', cancelled: 'Cancelled booking', 'pre-manifested': 'Pre-manifested' };
  for (const leg of flights) {
    const line = document.createElement('span');
    line.className = 'detail';
    if (leg.kind === 'cancelled') line.classList.add('cancelled');
    const route = [leg.origin, leg.destination].filter(Boolean).join(' → ');
    line.textContent = [
      labels[leg.kind],
      leg.pieces == null ? 'pieces not shown' : leg.pieces + ' pcs',
      [leg.flight, route].filter(Boolean).join(' '),
      leg.kind === 'cancelled' && leg.dateAsPublished ? 'scheduled ' + leg.dateAsPublished : leg.dateAsPublished
    ].filter(Boolean).join(' · ');
    cell.append(line);
  }
}

function renderResult(cells, result, previous, quickImage) {
  const verified = result.status === 'tracked' ? result : previous;
  const event = verified?.milestones?.[0];
  const latest = event && verified.milestones.filter(item =>
    item.statusDateAsPublished === event.statusDateAsPublished && item.station === event.station
  );
  const eventNames = latest && [...new Set(latest.map(item => item.event))].join(' / ');
  const status = [eventNames, event?.station].filter(Boolean).join(' · ');
  setText(cells.destination, verified?.route?.destination || '—');
  const itinerary = verified?.schedule?.legs?.filter(leg => !/^cancell?ed$/i.test(leg.bookingStatus)).map(leg =>
    [leg.flight, leg.origin + ' → ' + leg.destination, leg.departureAsPublished].join(' ')
  ).join(' / ');
  if (result.status === 'tracked') {
    const arrivals = verified.destinationArrival;
    const arrivalDetail = arrivals && [
      arrivals.arrivals.map(leg => leg.pieces + ' pcs on ' + leg.flight).join(' + '),
      arrivals.warehousePieces && arrivals.warehousePieces + ' pcs checked into the destination warehouse.'
    ].filter(Boolean).join(' · ');
    const detail = arrivalDetail || itinerary || event?.descriptionAsPublished || event?.flightDetailsAsPublished || (!verified.bookingCancellation && verified.schedule?.flight
      ? 'Scheduled ' + verified.schedule.flight + ' · ' + verified.schedule.dateAsPublished : '');
    const cancellation = verified.bookingCancellation === 'all' ? 'All listed flight bookings cancelled.'
      : verified.bookingCancellation === 'some' ? 'See cancelled flight legs under Pieces by flight.' : '';
    setText(cells.status, status, [cancellation, detail].filter(Boolean).join(' '));
  } else {
    const detail = previous
      ? 'Last verified ' + checkedTime(previous.observedAt) + ' · ' + status
      : result.status === 'ambiguous' ? result.message
        : result.status === 'no_record' ? 'The carrier returned no shipment record.' : '';
    const manual = (result.manualTrackingUrl || result.manualCheckRequired) && ['blocked', 'skipped'].includes(result.status);
    const label = manual ? 'Manual check required' : result.status === 'interrupted' ? 'Check interrupted' : 'Check failed';
    setText(cells.status, label, detail, true);
  }
  cells.status.classList.toggle('cancelled', result.status === 'tracked' && Boolean(result.bookingCancellation));
  setText(cells.eventTime, event?.statusDateAsPublished || '—');
  setText(cells.cargoDetail, [
    verified?.totalPieces == null ? null : verified.totalPieces.toLocaleString() + ' pcs',
    verified?.totalWeight,
    verified?.totalVolumeCbm
  ].filter(Boolean).join(' / '));
  renderPieces(cells.pieces, verified?.pieceTracking);
  const detail = result.shipmentDetail || previous?.shipmentDetail;
  renderShipmentDetail(cells.shipmentDetail, result.awb, detail, quickImage);
}

async function readResults(response, receive) {
  if (!response.ok) throw new Error((await response.json()).error);
  let pending = '';
  const stream = response.body.pipeThrough(new TextDecoderStream());
  for await (const chunk of stream) {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      const message = JSON.parse(line);
      if (message.error) throw new Error(message.error);
      if (!message.heartbeat) receive(message);
    }
  }
  if (pending) throw new Error('The tracker connection ended before the last result arrived.');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  let shipments;
  try {
    shipments = parseList(document.querySelector('#shipments').value);
  } catch (error) {
    progress.textContent = error.message;
    return;
  }
  submit.disabled = true;
  table.hidden = false;
  clearQuickImages();
  body.replaceChildren();
  const targets = new Map();
  const finished = new Set();
  let failures = 0;
  for (const shipment of shipments) {
    const row = body.insertRow();
    const cells = {};
    for (const [key, value] of Object.entries({
      awb: shipment.awb,
      shipper: shipment.shipper,
      destination: '—',
      status: 'Waiting to check',
      eventTime: '—',
      cargoDetail: '',
      pieces: '—',
      shipmentDetail: ''
    })) {
      cells[key] = row.insertCell();
      setText(cells[key], value);
    }
    renderShipmentDetail(cells.shipmentDetail, shipment.awb);
    const matches = targets.get(shipment.awb) || [];
    matches.push(cells);
    targets.set(shipment.awb, matches);
  }
  function showProgress() {
    progress.textContent = finished.size + ' of ' + targets.size + ' checked' + (failures ? ' · ' + failures + ' failed' : '');
  }
  showProgress();
  activeRequest = new AbortController();
  try {
    const response = await fetch('/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tracker-Queue-Updates': '1', 'X-Tracker-Heartbeat': '1' },
      body: JSON.stringify([...targets.keys()]),
      signal: activeRequest.signal
    });
    await readResults(response, message => {
      if (message.progress) {
        const queued = message.progress === 'queued';
        for (const rows of targets.values()) {
          for (const cells of rows) setText(cells.status, queued ? 'Queued' : 'Waiting to check');
        }
        if (queued) progress.textContent = 'Queued. This batch will start after the current one finishes.';
        else showProgress();
        return;
      }
      const { quickImage, ...result } = message.result;
      const previous = result.status === 'tracked' ? undefined : getCache().get(result.awb);
      let preview;
      if (quickImage && result.status === 'tracked') {
        const bytes = Uint8Array.from(atob(quickImage.jpeg), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        imageUrls.add(url);
        preview = { url, capturedAt: quickImage.capturedAt, carrier: result.carrier };
      }
      if (result.status === 'tracked') saveCache(result);
      else failures += 1;
      finished.add(result.awb);
      for (const cells of targets.get(result.awb)) {
        renderResult(cells, result, previous, preview);
      }
      showProgress();
    });
    if (finished.size < targets.size) throw new Error('The tracker stopped before all AWBs could be checked.');
  } catch (error) {
    progress.textContent = error.message;
    for (const [awb, rows] of targets) {
      if (finished.has(awb)) continue;
      const previous = getCache().get(awb);
      for (const cells of rows) {
        renderResult(cells, { awb, status: 'interrupted' }, previous);
      }
    }
  } finally {
    activeRequest = undefined;
    submit.disabled = false;
  }
});
