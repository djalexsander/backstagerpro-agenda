/**
 * Converts a Date to the value format expected by <input type="datetime-local">
 * (`YYYY-MM-DDTHH:mm`), representing the date's LOCAL wall-clock time.
 *
 * `date.toISOString()` alone always renders UTC - subtracting the timezone
 * offset first is what makes the slice below equal local time instead of
 * shifting it (e.g. 3 hours ahead in Brazil, UTC-3).
 */
export function toDatetimeLocalValue(date: Date): string {
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

/** Current local date/time as a fresh `datetime-local` value. */
export function nowAsDatetimeLocalValue(): string {
  return toDatetimeLocalValue(new Date());
}
