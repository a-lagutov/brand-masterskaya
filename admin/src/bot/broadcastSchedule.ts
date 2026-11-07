/** Persisted scheduling fields shared by approval, calendar calculations and the dispatcher. */
export type BroadcastSchedule = {
  scheduleMode?: string | null;
  scheduledAt?: string | null;
  scheduleUntil?: string | null;
};
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Validates a saved draft at explicit approval, never activating it through ordinary saves. */
export function validateBroadcastSchedule(
  schedule: BroadcastSchedule,
  now = new Date(),
): string | null {
  const mode = schedule.scheduleMode || 'now';
  if (!['now', 'once', 'daily', 'weekly', 'monthly'].includes(mode))
    return 'Выберите режим отправки.';
  if (mode === 'now') return null;
  const start = Date.parse(schedule.scheduledAt || '');
  if (!Number.isFinite(start) || start <= now.getTime())
    return 'Укажите будущую дату первого запуска по Москве.';
  if (mode !== 'once' && schedule.scheduleUntil) {
    const end = Date.parse(schedule.scheduleUntil);
    if (!Number.isFinite(end) || end < start)
      return 'Дата окончания должна быть не раньше первого запуска.';
  }
  return null;
}

/** Finds the next anchored Moscow occurrence, skipping missed intervals without a catch-up burst. */
export function nextBroadcastOccurrence(schedule: BroadcastSchedule, after: string): string | null {
  const start = Date.parse(schedule.scheduledAt || '');
  const reference = Date.parse(after);
  const mode = schedule.scheduleMode;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(reference) ||
    !['once', 'daily', 'weekly', 'monthly'].includes(mode || '')
  )
    return null;
  let candidate = start;
  if (reference >= start) {
    if (mode === 'once') return null;
    if (mode === 'daily' || mode === 'weekly') {
      const interval = DAY_MS * (mode === 'weekly' ? 7 : 1);
      candidate = start + (Math.floor((reference - start) / interval) + 1) * interval;
    } else {
      const anchor = new Date(start + MOSCOW_OFFSET_MS);
      const current = new Date(reference + MOSCOW_OFFSET_MS);
      let month = current.getUTCFullYear() * 12 + current.getUTCMonth();
      /** Clamps only this month, always retaining the original day for later months. */
      function monthTimestamp(monthIndex: number): number {
        const year = Math.floor(monthIndex / 12);
        const monthOfYear = monthIndex % 12;
        const lastDay = new Date(Date.UTC(year, monthOfYear + 1, 0)).getUTCDate();
        return (
          Date.UTC(
            year,
            monthOfYear,
            Math.min(anchor.getUTCDate(), lastDay),
            anchor.getUTCHours(),
            anchor.getUTCMinutes(),
            anchor.getUTCSeconds(),
            anchor.getUTCMilliseconds(),
          ) - MOSCOW_OFFSET_MS
        );
      }
      candidate = monthTimestamp(month);
      if (candidate <= reference) candidate = monthTimestamp(++month);
    }
  }
  if (mode !== 'once' && schedule.scheduleUntil && candidate > Date.parse(schedule.scheduleUntil))
    return null;
  return new Date(candidate).toISOString();
}
