import { THEMES, useTheme } from "../../hooks/useTheme";

export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  return (
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
  );
}
