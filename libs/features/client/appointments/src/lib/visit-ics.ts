/**
 * A visit as an `.ics` event — the one format every calendar on earth reads.
 *
 * ### Why a file and not a link
 * A Google Calendar template URL only serves people whose calendar IS Google
 * Calendar. An `.ics` opens in Apple Calendar, Outlook, Google and everything
 * else, offline, and it carries a stable `UID` — so re-adding the same
 * appointment UPDATES the event a person already has rather than giving them
 * a duplicate. That last part is what makes this safe to offer twice.
 *
 * Times are written in UTC (`Z`), which is the only form with no ambiguity
 * to resolve: a floating local time would land an hour out for anyone whose
 * device disagrees with the shop about daylight saving.
 */
export interface VisitCalendarEvent {
  /** Stable per appointment — re-import updates rather than duplicates. */
  readonly uid: string;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly location: string;
  readonly description: string;
}

/** `20260821T113000Z` — the iCalendar UTC form. */
function toIcsUtc(millis: number): string {
  return `${new Date(millis)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')}`;
}

/**
 * Escape the four characters iCalendar treats as structure.
 *
 * Order matters: the backslash has to go first, or it would escape the
 * escapes added after it.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a line to 75 octets, as RFC 5545 requires — a continuation begins
 * with one space. Unfolded long lines are the reason a note with a shop
 * address in it silently breaks an import in Outlook.
 */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/**
 * The event, as a complete single-event calendar.
 *
 * `stampMs` is passed in rather than read from the clock here: this module
 * is pure so its output is reproducible in a test, and the caller already
 * holds a Clock port.
 */
export function buildVisitIcs(
  event: VisitCalendarEvent,
  stampMs: number,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Creativo//Booking//BG',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsUtc(stampMs)}`,
    `DTSTART:${toIcsUtc(event.startMs)}`,
    `DTEND:${toIcsUtc(event.endMs)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    // A reminder is the point of putting it in a calendar at all; two hours
    // is enough to leave for a haircut and not enough to forget again.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Creativo',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // CRLF, not LF: RFC 5545 says so, and Outlook is the one that enforces it.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
