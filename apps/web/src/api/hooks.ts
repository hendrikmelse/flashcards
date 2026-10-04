import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ChangeEmailInput,
  ChangePasswordInput,
  DeckCardDetail,
  DeckResponse,
  DeleteAccountInput,
  DeckSort,
  LoginInput,
  PublicUser,
  RegisterInput,
  ReportCardInput,
  Settings,
  UpdateSettingsInput,
  StatsResponse,
  StudyCountsResponse,
} from "@flashcards/shared";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
import { clearRemembered } from "../hooks/useRemembered";
import { api } from "./client";

export const ME = ["me"] as const;

// Swap the signed-in user and drop everything cached for the previous one.
// The "me" query is updated in place (not removed) so mounted components that
// observe it re-render.
function setUser(qc: QueryClient, user: PublicUser | null) {
  clearRemembered(); // the next person does not inherit the last one's filters
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME[0] });
  qc.setQueryData(ME, user);
}

// The current user, or null when logged out. The server answers 200 either
// way, so a logged-out visitor causes no failed request; a real failure (server
// down, 5xx) is an error.
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async () => (await api<{ user: PublicUser | null }>("/auth/me")).user,
    retry: false,
    staleTime: Infinity,
  });
}

function useStartSession(path: "/auth/login" | "/auth/register") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput | RegisterInput) =>
      api<{ user: PublicUser }>(path, { method: "POST", body: input }),
    onSuccess: ({ user }) => setUser(qc, user),
  });
}

export const useLogin = () => useStartSession("/auth/login");
export const useRegister = () => useStartSession("/auth/register");

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
}

// Both settings change what is ready to study (the daily limit, and where the study day starts).
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSettingsInput) => {
      const [settings] = await Promise.all([
        api<Settings>("/settings", { method: "PATCH", body: input }),
        new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS)),
      ]);
      return settings;
    },
    onSuccess: (settings) => {
      qc.setQueryData(["settings"], settings);
      qc.setQueryData<PublicUser | null | undefined>(ME, (user) => (user ? { ...user, name: settings.name } : user));
      for (const key of ["study", "stats", "deck"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

// Account changes that need the current password.
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api<void>("/account/password", { method: "POST", body: input }),
  });
}

export function useChangeEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangeEmailInput) =>
      api<{ user: PublicUser }>("/account/email", { method: "POST", body: input }),
    onSuccess: ({ user }) => {
      qc.setQueryData(ME, user);
      qc.setQueryData<Settings | undefined>(["settings"], (s) => (s ? { ...s, email: user.email } : s));
    },
  });
}

// Deleting the account signs the user out, which sends them to the login page.
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteAccountInput) => api<void>("/account/delete", { method: "POST", body: input }),
    onSuccess: () => setUser(qc, null),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => setUser(qc, null),
  });
}

// Dashboard numbers, for the language pair being learned: each pair is a deck of its own, and `deck`
// is the progress summary of the whole pair, both directions together.
export function useDashboard() {
  const { pair } = useActiveLanguages();
  const deck = useQuery({
    queryKey: ["deck", "summary", pair, "all"],
    queryFn: () => api<DeckResponse>(`/deck?limit=1&pair=${pair}`),
  });
  const study = useQuery({
    queryKey: ["study", "counts", pair],
    queryFn: () => api<StudyCountsResponse>(`/study/counts?pair=${pair}`),
  });
  // Extras: the dashboard still works without them.
  const stats = useStats();
  return { deck, study, stats };
}

// What is ready to study, for the language pair being learned. The dashboard asks the same question
// (the same cache entry), so a page that only wants to know whether to offer "Start studying" costs
// nothing extra after it.
export function useStudyCounts() {
  const { pair } = useActiveLanguages();
  return useQuery({
    queryKey: ["study", "counts", pair],
    queryFn: () => api<StudyCountsResponse>(`/study/counts?pair=${pair}`),
    // Only the page header asks this way, to decide whether to offer a button: what the dashboard
    // fetched a moment ago is good enough, so arriving on a page does not ask the server again.
    staleTime: 30_000,
  });
}

export function useStats() {
  const { pair } = useActiveLanguages();
  return useQuery({
    queryKey: ["stats", pair],
    queryFn: () => api<StatsResponse>(`/stats?pair=${pair}`),
  });
}

// One deck card in full, with its example sentences, for the deck viewer's card view.
export function useDeckCard(id: string) {
  return useQuery({
    queryKey: ["deck", "card", id],
    queryFn: () => api<DeckCardDetail>(`/deck/${id}`),
  });
}

// A problem someone found with a word's card.
export function useReportCard(conceptId: string) {
  return useMutation({
    mutationFn: (input: Omit<ReportCardInput, "fromLanguage" | "toLanguage"> & { fromLanguage: string; toLanguage: string }) =>
      api<{ ok: true }>(`/concepts/${conceptId}/report`, { method: "POST", body: input }),
  });
}

const DECK_PAGE_SIZE = 50;
// Shortest time a "load more" spinner shows, so a fast response doesn't flash it.
const MIN_SPINNER_MS = 300;

export type DeckStage = "all" | "new" | "learning" | "review";

// The cards in the user's deck, a page at a time, narrowed by direction, stage and a search term.
export function useDeckCards(
  direction: { from: string; to: string } | null,
  stage: DeckStage,
  term: string,
  sort: DeckSort,
  order: "asc" | "desc",
) {
  const { pair } = useActiveLanguages();
  const key = direction ? [direction.from, direction.to] : ["all"];
  return useInfiniteQuery({
    queryKey: ["deck", "list", pair, ...key, stage, term, sort, order],
    initialPageParam: 0,
    placeholderData: (previous) => previous,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(DECK_PAGE_SIZE), offset: String(pageParam), pair });
      if (direction) {
        params.set("fromLanguage", direction.from);
        params.set("toLanguage", direction.to);
      }
      if (stage !== "all") params.set("state", stage);
      if (term) params.set("q", term);
      params.set("sort", sort);
      params.set("order", order);
      const request = api<DeckResponse>(`/deck?${params}`);
      const wait = pageParam === 0 ? 0 : MIN_SPINNER_MS;
      const [page] = await Promise.all([request, new Promise((r) => setTimeout(r, wait))]);
      return page;
    },
    getNextPageParam: (last: DeckResponse, pages: DeckResponse[]) =>
      last.hasMore ? pages.length * DECK_PAGE_SIZE : undefined,
  });
}
