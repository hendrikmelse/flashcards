import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";
import { ADD_WORDS_DIRECTION, LANGUAGE_CODES, type PublicUser, type Settings } from "@flashcards/shared";
import { api } from "../api/client";
import { ME, useMe } from "../api/hooks";
import type { Direction } from "../api/packs";
import { ActiveLanguagesContext, isValidDirection, makeActiveLanguages } from "../hooks/useActiveLanguages";

/**
 * The language pair and direction the user is learning, which every page works in. It is an
 * account setting, so it comes with the signed-in user (no extra request, and the same on every
 * device) and changing it is saved to the account at once. Until the user has chosen, and when
 * signed out, it is ADD_WORDS_DIRECTION. Nothing in the app changes it yet; a language switcher
 * would call `setDirection`.
 */
export function ActiveLanguagesProvider({
  children,
  languages = LANGUAGE_CODES,
}: {
  children: ReactNode;
  /** The languages that can be chosen: the supported ones. Tests give it more. */
  languages?: readonly string[];
}) {
  const qc = useQueryClient();
  const { data: user } = useMe();
  const saved = user?.direction;
  const direction: Direction = isValidDirection(languages, saved) ? saved : { ...ADD_WORDS_DIRECTION };

  const save = useMutation({
    mutationFn: (d: Direction) => api<Settings>("/settings", { method: "PATCH", body: { direction: d } }),
    onSuccess: (settings) => qc.setQueryData<Settings | undefined>(["settings"], (s) => (s ? { ...s, direction: settings.direction } : s)),
  });

  const { mutate } = save;
  const setDirection = useCallback(
    (d: Direction) => {
      if (!isValidDirection(languages, d)) return;
      const before = qc.getQueryData<PublicUser | null>(ME)?.direction;
      const show = (to: PublicUser["direction"] | undefined) =>
        to && qc.setQueryData<PublicUser | null | undefined>(ME, (u) => (u ? { ...u, direction: to } : u));
      // Shown at once; if it cannot be saved, the old one comes back.
      show({ from: d.from as PublicUser["direction"]["from"], to: d.to as PublicUser["direction"]["to"] });
      mutate(d, { onError: () => show(before) });
    },
    [languages, qc, mutate],
  );

  const value = useMemo(() => makeActiveLanguages(direction, setDirection), [direction, setDirection]);
  return <ActiveLanguagesContext.Provider value={value}>{children}</ActiveLanguagesContext.Provider>;
}
