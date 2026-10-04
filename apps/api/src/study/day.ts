import { isValidTimeZone } from "@flashcards/shared";

// A "study day" runs from 04:00 to 04:00 in the user's timezone, so studying
// shortly after midnight still counts toward the previous day.
export const DAY_ROLLOVER_HOUR = 4;

// Offset of `timeZone` from UTC at `instant`, in ms (east of UTC is positive).
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant the study day after the one containing `now` ends, i.e. when the day after tomorrow begins. */
export function endOfTomorrow(now: Date, timeZone: string): Date {
  // 30 hours always lands inside the next study day, whatever DST does to day lengths.
  const tomorrow = studyDayStart(new Date(studyDayStart(now, timeZone).getTime() + 30 * 3_600_000), timeZone);
  return studyDayStart(new Date(tomorrow.getTime() + 30 * 3_600_000), timeZone);
}

/** The instant the current study day began for a user in `timeZone`. */
export function studyDayStart(
  now: Date,
  timeZone: string,
  rolloverHour = DAY_ROLLOVER_HOUR,
): Date {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const t = now.getTime();

  // Work in "wall clock as UTC" space: shift back by the rollover hour to find
  // which calendar date the study day belongs to.
  const wallNow = t + offsetMs(t, tz);
  const shifted = new Date(wallNow - rolloverHour * 3_600_000);
  const wallStart = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    rolloverHour,
  );

  // Convert that wall-clock time back to an instant. Two passes handle the
  // offset changing between the guess and the answer (DST).
  let guess = wallStart - offsetMs(wallStart, tz);
  guess = wallStart - offsetMs(guess, tz);
  return new Date(guess);
}
