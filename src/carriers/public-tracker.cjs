const { basename, dirname, join } = require('node:path');

async function trackPublicPage(context, entry, screenshotPath, lookup) {
  const page = await context.newPage();
  let resultPage = page;
  page.setDefaultTimeout(20_000);
  let stage = 'public_form';
  let observation;
  try {
    const response = await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (response.status() >= 400) {
      observation = {
        status: [401, 403, 429].includes(response.status()) ? 'blocked' : 'site_error',
        message: `Carrier returned HTTP ${response.status()}.`
      };
    } else {
      if (new URL(page.url()).origin !== new URL(entry).origin) {
        throw new Error('The tracking form redirected to a different site.');
      }
      stage = 'result';
      observation = await lookup(page, popup => { resultPage = popup; });
    }
  } catch (error) {
    const challenged = /^(just a moment|attention required|access denied|forbidden|verify (?:that )?you are human)\b/i.test(
      await resultPage.title().catch(() => '')
    ) || await resultPage.locator('iframe[src*="challenges.cloudflare.com"]:visible, iframe[src*="recaptcha"]:not([src*="size=invisible"]):visible').count().catch(() => 0);
    observation = {
      status: challenged ? 'blocked' : 'unverified',
      message: challenged ? 'The carrier displayed an access challenge.' : error.message.split('\n')[0]
    };
  }

  let screenshot;
  if (screenshotPath) {
    try {
      await resultPage.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 });
      screenshot = join(basename(dirname(screenshotPath)), basename(screenshotPath)).replaceAll('\\', '/');
    } catch {
      // A missing screenshot does not invalidate the observed result.
    }
  }
  return {
    stage,
    source: { entry, finalUrl: resultPage.url() },
    milestones: [],
    screenshot,
    ...observation
  };
}

async function dismissCookieBanner(page, label) {
  const accept = page.getByRole('button', { name: label, exact: true });
  if (await accept.isVisible()) await accept.click();
}

async function captureShipmentPreview(shipment) {
  try {
    const image = await shipment.screenshot({
      type: 'jpeg', quality: 82, scale: 'css', animations: 'disabled', timeout: 5_000
    });
    if (image.length > 0 && image.length <= 1_000_000) {
      return { jpeg: image.toString('base64'), capturedAt: new Date().toISOString() };
    }
  } catch {
    // Keep the verified status available if the optional preview fails.
  }
  return undefined;
}

module.exports = { trackPublicPage, dismissCookieBanner, captureShipmentPreview };
