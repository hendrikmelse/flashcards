import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  DeckResponse,
  DeckSort,
  LoginInput,
  PublicUser,
  RegisterInput,
  StatsResponse,
  StudyResponse,
} from "@flashcards/shared";
import { api } from "./client";

const ME = ["me"] as const;

// Swap the signed-in user and drop everything cached for the previous one.
// The "me" query is updated in place (not removed) so mounted components that
// observe it re-render.
function setUser(qc: QueryClient, user: PublicUser | null) {
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

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => setUser(qc, null),
  });
}

// Dashboard numbers: deck totals and what is ready to study right now, for one
// direction or (null) for the whole deck, plus reviews today and per-direction stats.
export function useDashboard(direction: { from: string; to: string } | null) {
  const dir = direction
    ? `&fromLanguage=${encodeURIComponent(direction.from)}&toLanguage=${encodeURIComponent(direction.to)}`
    : "";
  const key = direction ? [direction.from, direction.to] : ["all"];
  const deck = useQuery({
    queryKey: ["deck", "summary", ...key],
    queryFn: () => api<DeckResponse>(`/deck?limit=1${dir}`),
    placeholderData: (previous) => previous,
  });
  const study = useQuery({
    queryKey: ["study", "counts", ...key],
    queryFn: () => api<StudyResponse>(`/study?limit=1${dir}`),
    placeholderData: (previous) => previous,
  });
  // Extras: the dashboard still works without them.
  const stats = useStats();
  return { deck, study, stats };
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => api<StatsResponse>("/stats"),
  });
}

export const DECK_PAGE_SIZE = 50;
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
  const key = direction ? [direction.from, direction.to] : ["all"];
  return useInfiniteQuery({
    queryKey: ["deck", "list", ...key, stage, term, sort, order],
    initialPageParam: 0,
    placeholderData: (previous) => previous,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(DECK_PAGE_SIZE), offset: String(pageParam) });
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
