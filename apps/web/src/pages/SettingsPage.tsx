import { useEffect, useRef, type KeyboardEvent } from "react";
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

  // On a narrow screen the tabs scroll sideways. The bar says which side has more tabs beyond it
  // (data-more-start / data-more-end), and the phone styles fade that edge as a cue to swipe.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const update = () => {
      const more = el.scrollWidth - el.clientWidth > 1;
      el.toggleAttribute("data-more-start", more && el.scrollLeft > 1);
      el.toggleAttribute("data-more-end", more && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const smooth = () => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

  // The tab that is opened scrolls toward the middle of the bar, as far as the bar allows.
  useEffect(() => {
    const el = bar.current;
    const selected = document.getElementById(`tab-${tab}`);
    if (!el || !selected || el.scrollWidth <= el.clientWidth) return;
    const at = selected.getBoundingClientRect();
    const barAt = el.getBoundingClientRect();
    const left = el.scrollLeft + (at.left - barAt.left) - (el.clientWidth - at.width) / 2;
    el.scrollTo?.({ left, behavior: smooth() });
  }, [tab]);

  // The arrows at the sides move the bar most of a screenful toward that side.
  function scrollBar(direction: -1 | 1) {
    const el = bar.current;
    el?.scrollBy?.({ left: direction * el.clientWidth * 0.6, behavior: smooth() });
  }

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
      <div className="tabs-wrap">
        <div ref={bar} className="tabs" role="tablist" aria-label="Settings sections" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              data-label={t.label}
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
        {/* Arrows for the phone styles, shown at a side that has more tabs beyond it. They are for
            touch; the arrow keys already move between the tabs, so they stay out of the tab order. */}
        <button
          type="button"
          className="tabs-arrow tabs-arrow-start"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => scrollBar(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="tabs-arrow tabs-arrow-end"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => scrollBar(1)}
        >
          ›
        </button>
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
