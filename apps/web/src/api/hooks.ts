import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  DeckResponse,
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
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<StatsResponse>("/stats"),
  });
  return { deck, study, stats };
}
