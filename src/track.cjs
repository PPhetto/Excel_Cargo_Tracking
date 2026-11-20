const { parseArgs } = require('node:util');
const { resolve, join } = require('node:path');
const { mkdir, mkdtemp } = require('node:fs/promises');
const { trackBatch } = require('./batch.cjs');

const usage = 'Usage: npm run track -- [--headed] [--channel msedge|chrome] [--evidence DIR] AWB [AWB ...]';

async function run() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      headed: { type: 'boolean' },
      channel: { type: 'string' },
      evidence: { type: 'string' },
      help: { type: 'boolean' }
    }
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!positionals.length) throw new Error(usage);
  if (values.channel && !['msedge', 'chrome'].includes(values.channel)) {
    throw new Error('--channel must be msedge or chrome. Omit it to use Playwright Chromium.');
  }

  let evidenceDir;
  if (values.evidence) {
    const parent = resolve(values.evidence);
    await mkdir(parent, { recursive: true });
    evidenceDir = await mkdtemp(join(parent, 'run-'));
  }
  const report = await trackBatch(positionals, { channel: values.channel, headed: values.headed, evidenceDir });
  console.log(JSON.stringify(report, null, 2));
  if (report.results.some(result => result.status !== 'tracked')) process.exitCode = 2;
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
