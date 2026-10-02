import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { App } from "../App";

export type Handler = (body: unknown) => { status: number; body?: unknown };
export const json = (status: number, body?: unknown) => ({ status, body });

export const USER = { id: "u1", email: "ann@example.com" };

// Shared mutable state for one test; reset by installMockApi().
export const mock = {
  loggedIn: false,
  calls: [] as string[],
  handlers: {} as Record<string, Handler>,
};

function defaultHandlers(): Record<string, Handler> {
  return {
    "GET /auth/me": () => json(200, { user: mock.loggedIn ? USER : null }),
    "POST /auth/login": () => {
      mock.loggedIn = true;
      return json(200, { user: USER });
    },
    "POST /auth/register": () => {
      mock.loggedIn = true;
      return json(201, { user: USER });
    },
    "POST /auth/logout": () => {
      mock.loggedIn = false;
      return json(204);
    },
    "GET /deck?limit=1": () =>
      json(200, {
        summary: { total: 12, new: 5, learning: 2, relearning: 1, review: 4, dueNow: 3 },
      }),
    "GET /study?limit=1": () => json(200, { now: "x", counts: { learning: 1, review: 3, new: 7 } }),
    "GET /stats": () =>
      json(200, {
        now: "2026-01-15T10:00:00.000Z",
        reviewsToday: 9,
        nextDueAt: null,
        directions: [
          { fromLanguage: "en", toLanguage: "nl", total: 12, new: 5, learning: 3, review: 4, dueNow: 4, nextDueAt: null },
        ],
      }),
    "GET /languages": () =>
      json(200, {
        languages: [
          { code: "en", name: "English" },
          { code: "nl", name: "Nederlands" },
        ],
      }),
  };
}

// Replaces fetch with a router over mock.handlers. A handler is found by the
// exact "METHOD /path?query" first, then by "METHOD /path".
export function installMockApi() {
  mock.loggedIn = false;
  mock.calls = [];
  mock.handlers = defaultHandlers();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.replace(/^\/api/, "");
      const key = `${method} ${path}`;
      mock.calls.push(key);
      const handler = mock.handlers[key] ?? mock.handlers[`${method} ${path.split("?")[0]}`];
      if (!handler) throw new Error(`Unexpected request: ${key}`);
      const { status, body } = handler(init?.body ? JSON.parse(String(init.body)) : undefined);
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

export function renderApp(route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
