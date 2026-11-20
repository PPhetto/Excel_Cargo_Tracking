function pieceCount(value) {
  const match = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\s+(?:pcs|pieces))?$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const count = Number(match[1].replaceAll(',', ''));
  return Number.isSafeInteger(count) ? count : null;
}

function flightNumber(value) {
  const match = /^([A-Z0-9]{2})\s*(\d{3,4}[A-Z]?)\b/i.exec(value || '');
  if (!match) return null;
  return match[1].toUpperCase() + match[2].toUpperCase().padStart(4, '0');
}

function flightDay(value) {
  const numericDate = /\b(\d{2})\.(\d{2})\.\d{4}\b/.exec(value || '');
  if (numericDate) {
    const month = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[Number(numericDate[2]) - 1];
    if (month) return Number(numericDate[1]) + ' ' + month;
  }
  const match = /\b(\d{1,2})\s+([a-z]{3})\b/i.exec(value || '');
  return match && Number(match[1]) + ' ' + match[2].toUpperCase();
}

function publishedFlight(event, kind) {
  const details = event.flightDetailsAsPublished;
  const flight = flightNumber(details);
  const dayInDetails = flightDay(details);
  const pieces = pieceCount(event.piecesAsPublished);
  // A booking event date is when the booking was recorded. Only its flight
  // details can establish the date the booking is for.
  if (kind === 'booking reported' && (!flight || !dayInDetails)) return null;
  const plannedTime = /,\s*([^,]+),\s*STD\s+([^,]+)/i.exec(details || '');
  const dateAsPublished = kind === 'departed' ? event.statusDateAsPublished
    : plannedTime?.slice(1).join(' ') || details;
  return {
    kind,
    origin: event.station,
    destination: /\b([A-Z]{3})-([A-Z]{3})\b/.exec(details || '')?.[2],
    flight,
    day: dayInDetails || flightDay(event.statusDateAsPublished),
    dateAsPublished,
    pieces
  };
}

function summarizePieces(result) {
  const total = pieceCount(result.totalPieces);
  const origin = result.route?.origin;
  const milestones = result.milestones || [];
  const departures = milestones.filter(event => /^(?:departed|dep)$/i.test(event.event))
    .map(event => publishedFlight(event, 'departed')).filter(Boolean);
  const reservationLegs = result.schedule?.legs || [];
  const bookings = reservationLegs.filter(leg => /^(?:Confirmed|Pre-manifested)$/i.test(leg.bookingStatus) && !leg.actualDepartureAsPublished)
    .map(leg => ({
      kind: leg.bookingStatus === 'Pre-manifested' ? 'pre-manifested' : 'booked',
      origin: leg.origin,
      destination: leg.destination,
      flight: flightNumber(leg.flight),
      day: flightDay(leg.departureAsPublished),
      dateAsPublished: leg.departureAsPublished,
      pieces: pieceCount(leg.pieces)
    }));
  const reportedBookings = milestones.filter(event => /^booking confirmed$/i.test(event.event))
    .map(event => publishedFlight(event, 'booking reported')).filter(Boolean);
  const cancelled = reservationLegs.filter(leg => /^cancell?ed$/i.test(leg.bookingStatus))
    .map(leg => ({
      kind: 'cancelled',
      origin: leg.origin,
      destination: leg.destination,
      flight: flightNumber(leg.flight),
      dateAsPublished: leg.departureAsPublished,
      pieces: pieceCount(leg.pieces)
    }));
  const sameFlight = (a, b) => a.flight && a.flight === b.flight && a.day && a.day === b.day && a.origin === b.origin;
  const fromOrigin = departures.filter(leg => origin && leg.origin === origin);
  const fullDepartureHistory = fromOrigin.length && fromOrigin.every((leg, index) =>
    leg.pieces !== null && leg.flight && leg.day && !fromOrigin.slice(0, index).some(other => sameFlight(other, leg)));
  const sum = fromOrigin.reduce((count, leg) => count + (leg.pieces || 0), 0);
  const originDeparted = fullDepartureHistory && (total === null || sum <= total) ? sum : null;
  const plans = [...bookings, ...reportedBookings].filter((leg, index, all) =>
    !(leg.origin === origin && total !== null && originDeparted === total) &&
    !departures.some(other => sameFlight(leg, other)) &&
    !all.slice(0, index).some(other => sameFlight(leg, other)));
  return {
    total,
    origin,
    originDeparted,
    flights: [...departures, ...plans, ...cancelled].map(({ day, ...leg }) => leg)
  };
}

module.exports = { pieceCount, summarizePieces };
