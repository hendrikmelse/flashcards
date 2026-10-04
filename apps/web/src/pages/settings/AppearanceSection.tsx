import { THEMES, useTheme } from "../../hooks/useTheme";
import { useRatingShortcuts } from "../../hooks/useRatingShortcuts";

export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const [shortcuts, setShortcuts] = useRatingShortcuts();
  return (
    <>
      <fieldset className="setting">
        <legend className="setting-title">Theme</legend>
        {THEMES.map(({ value, label }) => (
          <label key={value} className="check-row">
            <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => setTheme(value)} />
            {label}
          </label>
        ))}
        <p className="muted">Only applies on this device</p>
      </fieldset>
      <div className="section-gap">
        <fieldset className="setting">
          <legend className="setting-title">Keyboard</legend>
          <label className="check-row">
            <input type="checkbox" checked={shortcuts} onChange={(e) => setShortcuts(e.target.checked)} />
            Rate a card with the number keys 1 to 4
          </label>
          <p className="muted">
            Turn this off if single keys clash with voice control or assistive software. Only applies on this device
          </p>
        </fieldset>
      </div>
    </>
  );
}
