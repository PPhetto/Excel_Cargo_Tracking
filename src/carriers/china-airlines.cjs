const { trackIcargo } = require('./icargo-tracker.cjs');

const prefix = '297';
const name = 'China Airlines Cargo';
const entry = 'https://icargowebportal.china-airlines.com/icargoneoportal/app/main/#/app';
const options = { entry, name, airline: 'CI', preview: true };

module.exports = { prefix, name, trackingPage: entry, manualOnBlock: true,
  track: (context, awb, settings) => trackIcargo(context, awb, options, settings) };
