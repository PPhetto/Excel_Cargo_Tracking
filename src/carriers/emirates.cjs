const { trackAccelya } = require('./accelya-tracker.cjs');

const prefix = '176';
const name = 'Emirates SkyCargo';
const options = {
  entry: 'https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer',
  carrierLabel: name,
  airline: 'EK',
  cancellation: /\b(?:your order (?:is|has been) |booking |order )cancell?ed\b|^cancell?ed$/i,
  bookingCode: 'BKD',
  bookingStatus: 'Confirmed'
};

module.exports = { prefix, name, trackingPage: options.entry, track: (context, awb, settings) => trackAccelya(context, awb, options, settings) };
