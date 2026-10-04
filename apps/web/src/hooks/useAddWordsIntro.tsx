import { useState } from "react";
import { useSettings, useUpdateSettings } from "../api/hooks";
import { AddWordsIntro } from "../components/AddWordsIntro";

// The explainer that stands in for any page where words can be added (the list of packs, and a
// pack's own page, which the dashboard links to directly) until it is dismissed, once, for the
// account. The page returns it in place of itself while it is there, and shows itself otherwise.
// It goes at once on the click, while the change is being saved, and is never shown while the
// settings are still loading.
export function useAddWordsIntro() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const [dismissed, setDismissed] = useState(false);
  if (settings.data?.addWordsIntroSeen !== false || dismissed) return null;
  return (
    <AddWordsIntro
      onDismiss={() => {
        setDismissed(true);
        updateSettings.mutate({ addWordsIntroSeen: true }, { onError: () => setDismissed(false) });
      }}
    />
  );
}
