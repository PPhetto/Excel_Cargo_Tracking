const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { routeAwb, shipmentDetail } = require('./carriers.cjs');
const { trackBatch } = require('./batch.cjs');

// const address = '127.0.0.1';
// const port = Number(process.env.ETK_PORT ?? '4178');
// if (!Number.isInteger(port) || port < 1 || port > 65_535) {
//   throw new Error('ETK_PORT must be an integer from 1 to 65535.');
// }
// const localOrigin = `http://${address}:${port}`;
// const publicUrl = process.env.ETK_PUBLIC_ORIGIN ? new URL(process.env.ETK_PUBLIC_ORIGIN) : null;
// if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' ||
//     publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash)) {
//   throw new Error('ETK_PUBLIC_ORIGIN must be an HTTPS origin with no path, query, or credentials.');
// }

const address = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? process.env.ETK_PORT ?? '4178');

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer from 1 to 65535.');
}

const localOrigin = process.env.ETK_PUBLIC_ORIGIN
  ? new URL(process.env.ETK_PUBLIC_ORIGIN).origin
  : `http://127.0.0.1:${port}`;

const publicUrl = process.env.ETK_PUBLIC_ORIGIN
  ? new URL(process.env.ETK_PUBLIC_ORIGIN)
  : null;

const origin = publicUrl?.origin || localOrigin;
const expectedHost = new URL(origin).host;
const browser = process.env.ETK_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chromium');
if (!['chromium', 'msedge', 'chrome'].includes(browser)) {
  throw new Error('ETK_BROWSER must be chromium, msedge, or chrome.');
}
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript']],
  ['/dashboard.css', ['dashboard.css', 'text/css']],
  ['/excel-logo.png', ['excel-logo.png', 'image/png']],
  ['/excel-cargo-hero.jpg', ['excel-cargo-hero.jpg', 'image/jpeg']],
  ['/excel-cargo-hero-binoculars.jpg', ['excel-cargo-hero-binoculars.jpg', 'image/jpeg']]
]);
let queue = Promise.resolve();
let pendingBatches = 0;

function json(response, code, message) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: message }));
}

async function handle(request, response) {
  if (request.headers.host?.toLowerCase() !== expectedHost) {
    return json(response, 403, 'Open the tracker using its configured address.');
  }
  const detail = request.method === 'GET' && /^\/shipment-detail\/(\d{3}-\d{8})$/.exec(request.url);
  if (detail) {
    let target;
    try {
      const { carrier, awb } = routeAwb(detail[1]);
      target = shipmentDetail(carrier, awb);
    } catch {
      return json(response, 404, 'No tracking page for this AWB.');
    }
    response.writeHead(302, { Location: target.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return response.end();
  }
  const file = files.get(request.url);
  if (request.method === 'GET' && file) {
    const [name, type] = file;
    const content = await readFile(join(__dirname, '../public', name));
    response.writeHead(200, {
      'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8`,
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    return response.end(content);
  }
  if (request.method !== 'POST' || request.url !== '/track') return json(response, 404, 'Page not found.');
  if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
    return json(response, 403, 'Start tracking from the dashboard.');
  }
  let raw = '';
  for await (const chunk of request.setEncoding('utf8')) {
    raw += chunk;
    if (raw.length > 8_192) return json(response, 413, 'The shipment list is too large.');
  }
  let numbers;
  try {
    const input = JSON.parse(raw);
    if (!Array.isArray(input) || !input.length || input.length > 50) throw new Error('Enter between 1 and 50 AWBs.');
    numbers = [...new Set(input.map(number => routeAwb(number).awb.number))];
  } catch (error) {
    return json(response, 400, error.message);
  }
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no'
  });
  const send = record => {
    if (!response.destroyed) response.write(JSON.stringify(record) + '\n');
  };
  const queueUpdates = request.headers['x-tracker-queue-updates'] === '1';
  const heartbeat = request.headers['x-tracker-heartbeat'] === '1'
    ? setInterval(() => send({ heartbeat: true }), 20_000)
    : undefined;
  response.once('close', () => clearInterval(heartbeat));
  if (pendingBatches && queueUpdates) send({ progress: 'queued' });
  pendingBatches += 1;
  const batch = queue.then(async () => {
    if (response.destroyed) return;
    if (queueUpdates) send({ progress: 'started' });
    await trackBatch(numbers, {
      channel: browser === 'chromium' ? undefined : browser,
      captureQuickImage: true,
      onResult: result => send({ result })
    });
  });
  queue = batch.catch(() => {});
  try {
    await batch;
  } catch {
    send({ error: 'Could not start the tracking browser. Check that the configured browser and tracker dependencies are installed.' });
  } finally {
    clearInterval(heartbeat);
    pendingBatches -= 1;
    response.end();
  }
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) json(response, 500, 'The tracker encountered an error.');
    else response.end();
  });
});
// server.listen(port, address, () => {
//   console.log(`Excel Group Cargo Tracker is listening on ${localOrigin}`);
//   if (publicUrl) console.log(`Configured staff URL: ${origin}`);
// });
server.listen(port, address, () => {
  console.log(`Excel Group Cargo Tracker is listening on ${address}:${port}`);
  if (publicUrl) console.log(`Configured staff URL: ${origin}`);
});
