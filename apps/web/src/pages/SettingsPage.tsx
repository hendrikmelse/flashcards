import { useEffect, useRef, useState, type FormEvent } from "react";
import { DAILY_NEW_CARD_MAX, NAME_MAX, updateSettingsSchema, type Settings } from "@flashcards/shared";
import { useSettings, useUpdateSettings } from "../api/hooks";

// How long the checkmark replaces the "Save" label after a save.
const CHECK_MS = 1500;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Every time zone this browser knows, with the current one included even if the list is missing it.
function zoneOptions(current: string): string[] {
  const known: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([current, ...known, "UTC"])].sort((a, b) => a.localeCompare(b));
}

export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending) return <p className="status">Loading…</p>;
  if (settings.isError) return <p className="status error">Could not load your settings. Please refresh.</p>;
  return <SettingsForm saved={settings.data} />;
}

function SettingsForm({ saved }: { saved: Settings }) {
  const update = useUpdateSettings();
  const [name, setName] = useState(saved.name ?? "");
  const [limit, setLimit] = useState(String(saved.dailyNewCardLimit));
  const [timezone, setTimezone] = useState(saved.timezone);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // Shows a checkmark on the button for a moment after a successful save.
  const [checked, setChecked] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const detected = browserZone();
  const changed =
    name.trim() !== (saved.name ?? "") ||
    limit.trim() !== String(saved.dailyNewCardLimit) ||
    timezone !== saved.timezone;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const number = Number(limit);
    const parsed = updateSettingsSchema.safeParse({
      name,
      dailyNewCardLimit: limit.trim() === "" ? NaN : number,
      timezone,
    });
    if (!parsed.success) {
      const badLimit = parsed.error.issues.some((i) => i.path[0] === "dailyNewCardLimit");
      const badName = parsed.error.issues.some((i) => i.path[0] === "name");
      setLimitError(badLimit ? `Enter a whole number from 0 to ${DAILY_NEW_CARD_MAX}.` : null);
      setNameError(badName ? `Use ${NAME_MAX} characters or fewer.` : null);
      if (badLimit || badName) return;
    }
    setLimitError(null);
    setNameError(null);
    update.mutate(
      { name: name.trim(), dailyNewCardLimit: number, timezone },
      {
        onSuccess: () => {
          setChecked(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setChecked(false), CHECK_MS);
        },
      },
    );
  }

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">{saved.email}</p>

      <form className="settings" onSubmit={onSubmit} noValidate>
        <div className="setting">
          <label htmlFor="display-name">What should we call you?</label>
          <input
            id="display-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
          />
          {nameError && (
            <p role="alert" className="field-error">
              {nameError}
            </p>
          )}
        </div>

        <div className="setting">
          <label htmlFor="daily-new">New cards per day</label>
          <input
            id="daily-new"
            type="number"
            inputMode="numeric"
            min={0}
            max={DAILY_NEW_CARD_MAX}
            step={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            aria-invalid={limitError ? true : undefined}
            aria-describedby="daily-new-help"
          />
          <p id="daily-new-help" className="muted">
            How many new words you are introduced to each day, across all your decks. Reviews are never limited. Set it
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
          <select
            id="time-zone"
            className="dropdown"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="time-zone-help"
          >
            {zoneOptions(saved.timezone).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <p id="time-zone-help" className="muted">
            Your study day starts at 4 a.m. in this time zone: that is when your new cards for the day are refreshed
            and when reviews due that day become available.
          </p>
          {detected && detected !== timezone && (
            <p className="muted">
              Your browser is set to {detected.replace(/_/g, " ")}.{" "}
              <button type="button" className="link" onClick={() => setTimezone(detected)}>
                Use it
              </button>
            </p>
          )}
        </div>

        <div className="setting-actions">
          <button
            type="submit"
            className={checked ? "primary done" : "primary"}
            disabled={!changed || update.isPending}
            aria-busy={update.isPending}
            aria-label={update.isPending ? "Saving" : checked ? "Saved" : undefined}
          >
            {/* The label stays (hidden) so the button keeps its width under the spinner or checkmark. */}
            <span style={update.isPending || checked ? { visibility: "hidden" } : undefined}>Save</span>
            {update.isPending && <span className="spinner" aria-hidden="true" />}
            {checked && !update.isPending && (
              <span className="check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
          <span role="status" className="form-error">
            {update.isError ? "Could not save your settings. Please try again." : ""}
          </span>
        </div>
      </form>
    </>
  );
}
