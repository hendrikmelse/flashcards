import { useEffect, useRef, useState } from "react";
import { DAILY_NEW_CARD_MAX, updateSettingsSchema, type Settings } from "@flashcards/shared";
import { FieldStatus, useFieldSave } from "./useFieldSave";

/** How long after the last keystroke the daily limit is saved. */
export const LIMIT_DEBOUNCE_MS = 600;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Every time zone this browser knows, with the current one included even if the list is missing it.
function zoneOptions(current: string): string[] {
  const known: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([current, ...known, "UTC"])].sort((a, b) => a.localeCompare(b));
}

export function StudySection({ settings }: { settings: Settings }) {
  return (
    <>
      <ScheduleSettings saved={settings} />
      <CardDisplay saved={settings} />
    </>
  );
}

// These save themselves as they change: the time zone straight away, the daily limit shortly
// after typing stops (or when the box loses focus, or the tab is left). Each shows "Saved" right
// beside the control that was saved.
function ScheduleSettings({ saved }: { saved: Settings }) {
  const limitSave = useFieldSave();
  const zoneSave = useFieldSave();
  const [limit, setLimit] = useState(String(saved.dailyNewCardLimit));
  const [timezone, setTimezone] = useState(saved.timezone);
  const [limitError, setLimitError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Checks the typed limit, and saves it if it is valid and not what is already saved.
  function commitLimit() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const number = limit.trim() === "" ? NaN : Number(limit);
    if (!updateSettingsSchema.safeParse({ dailyNewCardLimit: number }).success) {
      setLimitError(`Enter a whole number from 0 to ${DAILY_NEW_CARD_MAX}.`);
      return;
    }
    setLimitError(null);
    if (number !== saved.dailyNewCardLimit) limitSave.save({ dailyNewCardLimit: number });
  }

  // Leaving the tab before the pause is over still saves what was typed.
  const commitRef = useRef(commitLimit);
  commitRef.current = commitLimit;
  useEffect(
    () => () => {
      if (timer.current !== undefined) commitRef.current();
    },
    [],
  );

  function onLimitChange(value: string) {
    setLimit(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commitRef.current(), LIMIT_DEBOUNCE_MS);
  }

  function changeZone(value: string) {
    setTimezone(value);
    if (value !== saved.timezone) zoneSave.save({ timezone: value });
  }

  const detected = browserZone();
  return (
    <div className="settings">
      <div className="setting">
        <label htmlFor="daily-new">New cards per day</label>
        <div className="inline-field">
          <input
            id="daily-new"
            type="number"
            inputMode="numeric"
            min={0}
            max={DAILY_NEW_CARD_MAX}
            step={1}
            value={limit}
            onChange={(e) => onLimitChange(e.target.value)}
            onBlur={commitLimit}
            aria-invalid={limitError ? true : undefined}
            aria-describedby="daily-new-help"
          />
          <FieldStatus failed={limitSave.failed} />
        </div>
        <p id="daily-new-help" className="muted">
          How many new words you are introduced to each day, across all your decks. Words you mark Good or Easy the
          first time you see them are ones you already know, so they do not count. Reviews are never limited. Set it
          to 0 to pause new words.
        </p>
        {limitError && (
          <p role="alert" className="field-error">
            {limitError}
          </p>
        )}
      </div>

      <div className="setting">
        <label htmlFor="time-zone">Time zone</label>
        <div className="inline-field">
          <select
            id="time-zone"
            className="dropdown"
            value={timezone}
            onChange={(e) => changeZone(e.target.value)}
            aria-describedby="time-zone-help"
          >
            {zoneOptions(saved.timezone).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <FieldStatus failed={zoneSave.failed} />
        </div>
        <p id="time-zone-help" className="muted">
          Your study day starts at 4 a.m. in this time zone: that is when your new cards for the day are refreshed
          and when reviews due that day become available.
        </p>
        <p className="muted zone-hint">
          {detected && detected !== timezone && (
            <>
              Your browser is set to {detected.replace(/_/g, " ")}.{" "}
              <button type="button" className="link" onClick={() => changeZone(detected)}>
                Use it
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// What the study cards show. Kept with the account, so it follows you to other devices, and saved
// as soon as a box is ticked.
function CardDisplay({ saved }: { saved: Settings }) {
  const sentencesSave = useFieldSave();
  const formsSave = useFieldSave();
  const [sentences, setSentences] = useState(saved.showSentences);
  const [forms, setForms] = useState(saved.showForms);

  return (
    <fieldset className="setting section-gap">
      <legend className="setting-title">On the study cards</legend>
      <div className="check-line">
        <label className="check-row">
          <input
            type="checkbox"
            checked={sentences}
            onChange={(e) => {
              const value = e.target.checked;
              setSentences(value);
              sentencesSave.save({ showSentences: value }, () => setSentences(!value));
            }}
          />
          Show example sentences
        </label>
        <FieldStatus failed={sentencesSave.failed} />
      </div>
      <div className="check-line">
        <label className="check-row">
          <input
            type="checkbox"
            checked={forms}
            onChange={(e) => {
              const value = e.target.checked;
              setForms(value);
              formsSave.save({ showForms: value }, () => setForms(!value));
            }}
          />
          Show word forms (plurals, verb forms) with the answer
        </label>
        <FieldStatus failed={formsSave.failed} />
      </div>
    </fieldset>
  );
}
