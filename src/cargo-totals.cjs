const amountPattern = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const weightPattern = new RegExp('^' + amountPattern + '\\s*(kg|kgs|k|lbs?|l)?$', 'i');
const volumePattern = new RegExp('^' + amountPattern + '\\s*(?:cbm|m3|m³|m\\^3|㎥|cm|mtq)$', 'i');

function labeledValue(contents, label) {
  const lines = contents.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const index = lines.findIndex(line => line.toLowerCase() === label.toLowerCase());
  return index >= 0 ? lines[index + 1] : undefined;
}

function publishedWeight(text) {
  const match = weightPattern.exec(text?.trim());
  if (!match) return undefined;
  const [, amount, unit] = match;
  return unit ? amount + (/^k/i.test(unit) ? ' kg' : ' lb') : amount + ' (weight)';
}

function publishedVolume(text) {
  const match = volumePattern.exec(text?.trim());
  return match ? match[1] + ' CBM' : undefined;
}

module.exports = { labeledValue, publishedWeight, publishedVolume };
