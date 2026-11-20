const { trackIcargo } = require('./icargo-tracker.cjs');

const prefix = '098';
const name = 'Air India Cargo';
const entry = 'https://aicargoportal.airindia.com/icargoneoportal/app/main/#/app';
const options = { entry, name, airline: 'AI' };

module.exports = { prefix, name, trackingPage: entry,
  track: (context, awb, settings) => trackIcargo(context, awb, options, settings) };
