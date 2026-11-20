# Excel Group Cargo Tracker — staff pilot

**Release** ETK 2.1 · 18/11/2026

This package contains the tracker, all eleven airline adapters, the Excel branding, and regression tests. Staff use a web browser. The server runs the airline lookups.

## Install on the pilot server

Use a supported Node.js LTS release. Node.js 24 is the version used for the local verification. Run the tracker as a regular service account with outbound HTTPS access to the carrier sites and their supporting resources. Install the Playwright browser for the same account that will run the tracker. [Node.js release support](https://nodejs.org/en/about/previous-releases) · [Playwright browser setup](https://playwright.dev/docs/browsers)

**Windows with installed Microsoft Edge**

    npm.cmd install --omit=dev
    $env:ETK_PUBLIC_ORIGIN = 'https://etk-pilot.example.com'
    $env:ETK_BROWSER = 'msedge'
    npm.cmd start

On Windows without Edge, run `npx.cmd playwright install chromium` and set `ETK_BROWSER` to `chromium` before starting.

**Linux with Playwright Chromium**

    npm install --omit=dev
    npx playwright install --with-deps chromium
    ETK_PUBLIC_ORIGIN=https://etk-pilot.example.com ETK_BROWSER=chromium npm start

On Linux, IT can install OS dependencies separately if the service account has restricted privileges. Replace the example URL with the actual staff-facing origin. Configure your service manager to run `npm start` from the extracted folder with the same environment variables. The backend listens at `127.0.0.1:4178`. Set `ETK_PORT` if the server already uses that port, and point the proxy to the same value.

## Give staff one private link

Publish the tracker at the root of a dedicated internal HTTPS address. Place it behind your existing staff sign-in and restrict access to the pilot group, including `POST /track`. Have the reverse proxy run on the same host as the tracker and forward requests to the loopback address. The tracker checks the incoming `Host` and the browser's `Origin` against `ETK_PUBLIC_ORIGIN`, so preserve both headers.

Use this location block inside the company's staff-authenticated HTTPS virtual host if you use NGINX. For a different proxy, apply the equivalent streaming settings. Keep the request open through the full batch and disable response buffering for streamed results. [NGINX proxy settings](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)

    location / {
        proxy_pass http://127.0.0.1:4178;
        proxy_set_header Host $http_host;
        proxy_set_header Origin $http_origin;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 90s;
    }

## Pilot acceptance checks

Run `npm test` from the extracted folder for the included regression tests.

1. Confirm the staff URL opens on a second computer and the pilot group can sign in. Verify access is denied without authorization, including direct requests to `/track`.
2. Run one recent, authorized AWB per airline and compare the latest status and piece counts with the official site. The supported prefixes are TG 217, SQ 618, KE 180, QR 157, AY 105, AI 098, TK 235, EK 176, JL 131, CI 297, and NH 205.
3. Submit a small batch from one staff computer while another submits a second batch. Confirm the second shows **Queued**, starts automatically, and receives its own results.
4. For SQ, check a cancelled booking and a split shipment with destination scans. For AY, check an AWB with both active and cancelled orders. For AI, compare the dashboard against **Activity View**. For TK, compare it against **Status History** and use **Track shipment detail** if the airline requires human verification.
5. For EK, check an AWB with both active and cancelled orders and an AWB with only cancelled orders.
6. Paste an AWB followed by a multiword shipper name and an AWB by itself. Confirm the first row displays the entire name, the second row has a blank **Shipper** cell, and **Destination** shows the destination from the carrier record for each shipment.
7. Open **Track shipment detail** from each airline's result. Confirm it opens in a new tab. Check the AWB on the TK, AY and EK detail pages or enter the displayed number on the tracking form.
8. Open **View quick image** from successful KE, JL, CI and NH results. Confirm the shipment details and capture time are shown and the image is cleared on refresh or when a new batch starts.
9. Compare **Cargo detail** with the shipment total on the carrier's website. Check one carrier that publishes CBM and one that omits it.

## Pilot behavior

The server runs one batch at a time and queues additional submissions. Each batch supports up to 50 AWBs. Last verified results are kept in each browser on the staff URL. Scheduled checks and shared shipment history are outside this pilot. The application does not require a ChatGPT account for staff use.

