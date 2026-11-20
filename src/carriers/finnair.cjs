const { trackAccelya } = require('./accelya-tracker.cjs');

const prefix = '105';
const name = 'Finnair Cargo';
const options = {
  entry: 'https://cargo.finnair.com/api/offerandorder/#/home/find-offer',
  carrierLabel: 'Finnair',
  airline: 'AY',
  commitWithEnter: true,
  cancellation: /\bYour order is cancel+ed\b/i,
  bookingCode: 'PRE',
  bookingStatus: 'Pre-manifested'
};

module.exports = { prefix, name, trackingPage: options.entry, track: (context, awb, settings) => trackAccelya(context, awb, options, settings) };
