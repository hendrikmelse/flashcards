import type { KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import type { Settings } from "@flashcards/shared";
import { useSettings } from "../api/hooks";
import { AppearanceSection } from "./settings/AppearanceSection";
import { DataSection } from "./settings/DataSection";
import { ProfileSection } from "./settings/ProfileSection";
import { SecuritySection } from "./settings/SecuritySection";
import { StudySection } from "./settings/StudySection";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "study", label: "Study" },
  { id: "appearance", label: "Appearance" },
  { id: "security", label: "Security" },
  { id: "data", label: "Your data" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const isTab = (value: string | null): value is TabId => TABS.some((t) => t.id === value);

export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending) return <p className="status">Loading…</p>;
  if (settings.isError) return <p className="status error">Could not load your settings. Please refresh.</p>;
  return <Settings_ settings={settings.data} />;
}

// The settings are grouped into sections shown one at a time, so each fits on a screen without
// scrolling. The open section is in the URL (?tab=study) so a reload or a link keeps it.
function Settings_({ settings }: { settings: Settings }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = isTab(asked) ? asked : "profile";

  function open(id: TabId) {
    setParams(id === "profile" ? {} : { tab: id }, { replace: true });
  }

  // Arrow keys, Home and End move between the tabs, as in any tab list.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((t) => t.id === tab);
    const to =
      e.key === "ArrowRight" ? (at + 1) % TABS.length
      : e.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    open(TABS[to]!.id);
    document.getElementById(`tab-${TABS[to]!.id}`)?.focus();
  }

  return (
    <>
      <h1>Settings</h1>
      <div className="tabs" role="tablist" aria-label="Settings sections" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => open(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "profile" && <ProfileSection settings={settings} />}
        {tab === "study" && <StudySection settings={settings} />}
        {tab === "appearance" && <AppearanceSection />}
        {tab === "security" && <SecuritySection />}
        {tab === "data" && <DataSection />}
      </section>
    </>
  );
}
