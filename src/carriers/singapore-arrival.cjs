const { pieceCount } = require('../pieces.cjs');

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function localTime(value) {
  const match = /^(\d{1,2})\s+([a-z]{3})\s+(\d{2}|\d{4})\s*\|\s*(\d{2}):(\d{2})$/i.exec(value ?? '');
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  const monthIndex = months.indexOf(month.toLowerCase());
  const fullYear = Number(year) + (year.length === 2 ? 2000 : 0);
  if (monthIndex < 0 || Number(hours) > 23 || Number(minutes) > 59) return null;
  const date = Date.UTC(fullYear, monthIndex, Number(day));
  if (new Date(date).getUTCDate() !== Number(day)) return null;
  // Compare times at the same airport without changing the carrier's displayed time.
  return { date, timestamp: date + (Number(hours) * 60 + Number(minutes)) * 60_000 };
}

function summarizeDestinationArrival(destination, total, movements) {
  if (!destination || !total) return null;
  const destinationEvents = movements.filter(event => event.station === destination);
  const byFlight = new Map();
  for (const row of destinationEvents.filter(event => event.event === 'Arrived')) {
    const flight = /^SQ\s*(\d{3,4})$/i.exec(row.flightDetailsAsPublished?.trim() ?? '');
    const when = localTime(row.statusDateAsPublished);
    const pieces = pieceCount(row.piecesAsPublished);
    if (!flight || !when || !pieces) return null;
    const number = 'SQ' + flight[1].padStart(4, '0');
    const key = number + ':' + when.date;
    const previous = byFlight.get(key);
    // Multiple counts for the same arrival may be updates or separate lots.
    if (previous && previous.pieces !== pieces) return null;
    if (!previous || previous.timestamp < when.timestamp) {
      byFlight.set(key, { flight: number, pieces, dateAsPublished: row.statusDateAsPublished, timestamp: when.timestamp });
    }
  }
  const arrivals = [...byFlight.values()].sort((a, b) => a.timestamp - b.timestamp);
  const arrived = arrivals.reduce((count, row) => count + row.pieces, 0);
  if (!arrived || arrived > total) return null;
  const warehouse = destinationEvents.some(row =>
    row.event === 'Checked into warehouse' && pieceCount(row.piecesAsPublished) === total
  );
  return {
    destination, total, arrived,
    latestArrivalAsPublished: arrivals.at(-1).dateAsPublished,
    arrivals: arrivals.map(({ timestamp, ...row }) => row),
    warehousePieces: warehouse ? total : null
  };
}

module.exports = { summarizeDestinationArrival };
