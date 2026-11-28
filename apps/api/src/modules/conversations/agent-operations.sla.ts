// SPDX-License-Identifier: AGPL-3.0-only
import type { AgentOperationsPolicy } from '@app/shared';

type BusinessHours = AgentOperationsPolicy['sla']['businessHours'];
type BusinessDay = keyof BusinessHours;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: BusinessDay;
}

const WEEKDAYS: readonly BusinessDay[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const MINUTE_MS = 60_000;
const MAX_SEARCH_DAYS = 370;

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekday = values['weekday']?.toLowerCase();
  if (!WEEKDAYS.includes(weekday as BusinessDay)) throw new Error('Invalid local weekday.');
  return {
    year: Number(values['year']),
    month: Number(values['month']),
    day: Number(values['day']),
    hour: Number(values['hour']),
    minute: Number(values['minute']),
    weekday: weekday as BusinessDay,
  };
}

function localTimeOnDate(
  year: number,
  month: number,
  day: number,
  time: string,
  timeZone: string,
): Date {
  const [hourText = '0', minuteText = '0'] = time.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = localEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(candidate), timeZone);
    const representedEpoch = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const next = localEpoch - (representedEpoch - candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

function addLocalDays(parts: LocalParts, days: number): Pick<LocalParts, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function intervalWindows(
  day: BusinessDay,
  date: Pick<LocalParts, 'year' | 'month' | 'day'>,
  businessHours: BusinessHours,
  timeZone: string,
): { start: Date; end: Date }[] {
  return businessHours[day].map(({ start, end }) => {
    const endsNextDay = end < start;
    const endDate = endsNextDay
      ? addLocalDays({ ...date, hour: 0, minute: 0, weekday: day }, 1)
      : date;
    return {
      start: localTimeOnDate(date.year, date.month, date.day, start, timeZone),
      end: localTimeOnDate(endDate.year, endDate.month, endDate.day, end, timeZone),
    };
  });
}

/** Returns a deadline after the requested number of business minutes; an empty schedule is 24/7. */
export function addBusinessMinutes(
  start: Date,
  minutes: number | null,
  timeZone: string,
  businessHours: BusinessHours,
): Date | null {
  if (minutes === null) return null;
  if (Object.values(businessHours).every((windows) => windows.length === 0)) {
    return new Date(start.getTime() + minutes * MINUTE_MS);
  }

  let remainingMs = minutes * MINUTE_MS;
  const startParts = localParts(start, timeZone);
  let cursor = start;

  // Begin one local day earlier so an overnight interval can continue into the start day.
  for (let offset = -1; offset < MAX_SEARCH_DAYS; offset += 1) {
    const date = addLocalDays(startParts, offset);
    const weekdayIndex = (WEEKDAYS.indexOf(startParts.weekday) + offset + 7) % 7;
    const day = WEEKDAYS[weekdayIndex];
    if (day === undefined) continue;
    const windows = intervalWindows(day, date, businessHours, timeZone).sort(
      (left, right) => left.start.getTime() - right.start.getTime(),
    );
    for (const window of windows) {
      const windowStart = Math.max(cursor.getTime(), window.start.getTime());
      const availableMs = window.end.getTime() - windowStart;
      if (availableMs <= 0) continue;
      if (availableMs >= remainingMs) return new Date(windowStart + remainingMs);
      remainingMs -= availableMs;
      cursor = window.end;
    }
  }
  throw new Error('No SLA deadline found within the configured search horizon.');
}

export function slaDeadlines(
  start: Date,
  priority: keyof AgentOperationsPolicy['sla']['targets'],
  sla: AgentOperationsPolicy['sla'],
): { firstResponseDueAt: Date | null; resolutionDueAt: Date | null } {
  const target = sla.targets[priority];
  return {
    firstResponseDueAt: addBusinessMinutes(
      start,
      target.firstResponseMinutes,
      sla.timeZone,
      sla.businessHours,
    ),
    resolutionDueAt: addBusinessMinutes(
      start,
      target.resolutionMinutes,
      sla.timeZone,
      sla.businessHours,
    ),
  };
}
