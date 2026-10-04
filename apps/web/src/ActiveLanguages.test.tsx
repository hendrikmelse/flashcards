import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectionSummary } from "@flashcards/shared";
import { Layout } from "./components/Layout";
import { ActiveLanguagesProvider } from "./components/ActiveLanguagesProvider";
import { useActiveLanguages } from "./hooks/useActiveLanguages";
import { isString, useRemembered } from "./hooks/useRemembered";
import { useDeckFilter } from "./hooks/useDeckFilter";
import { DashboardPage } from "./pages/DashboardPage";
import { USER, installMockApi, json, mock } from "./test/harness";

// The app supports English and Dutch so far. Whatever picks the language pair being learned is
// not built yet, so these tests give the provider a third language and switch with a button.
const WITH_FRENCH = ["en", "nl", "fr"];

beforeEach(() => installMockApi());
afterEach(() => vi.unstubAllGlobals());

function Switcher() {
  const { direction, pair, otherWay, setDirection } = useActiveLanguages();
  return (
    <div>
      <p data-testid="now">{`${direction.from}>${direction.to} | ${pair} | ${otherWay.from}>${otherWay.to}`}</p>
      <button onClick={() => setDirection({ from: "en", to: "fr" })}>English to French</button>
      <button onClick={() => setDirection({ from: "nl", to: "en" })}>Dutch to English</button>
      <button onClick={() => setDirection({ from: "en", to: "xx" })}>Nonsense</button>
      <button onClick={() => setDirection({ from: "en", to: "en" })}>Same</button>
    </div>
  );
}

function wrap(children: ReactNode, languages: readonly string[] = WITH_FRENCH) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActiveLanguagesProvider languages={languages}>{children}</ActiveLanguagesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const now = () => screen.getByTestId("now").textContent;

describe("the language pair being learned", () => {
  type Direction = { from: string; to: string };
  let saved: unknown[];
  const signedInWith = (direction: Direction | undefined) => {
    mock.loggedIn = true;
    mock.handlers["GET /auth/me"] = () => json(200, { user: { ...USER, direction } });
  };
  beforeEach(() => {
    saved = [];
    mock.handlers["PATCH /settings"] = (body) => {
      saved.push(body);
      return json(200, { direction: (body as { direction: Direction }).direction });
    };
  });

  it("is English to Dutch for someone who has not chosen, with the pair written the same either way round", async () => {
    signedInWith(undefined);
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
  });

  it("is the one saved on the account", async () => {
    signedInWith({ from: "en", to: "fr" });
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>fr | en-fr | fr>en"));
  });

  it("is English to Dutch when signed out", () => {
    wrap(<Switcher />);
    expect(now()).toBe("en>nl | en-nl | nl>en");
  });

  it("is saved to the account when changed, and shown at once", async () => {
    signedInWith({ from: "en", to: "nl" });
    const user = userEvent.setup();
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));

    await user.click(screen.getByRole("button", { name: "English to French" }));
    expect(now()).toBe("en>fr | en-fr | fr>en");
    await waitFor(() => expect(saved).toEqual([{ direction: { from: "en", to: "fr" } }]));
  });

  it("is not kept on this device: another visit gets whatever the account says", async () => {
    signedInWith({ from: "en", to: "nl" });
    const user = userEvent.setup();
    const first = wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
    await user.click(screen.getByRole("button", { name: "English to French" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    first.unmount();

    expect(localStorage.getItem("activeLanguages")).toBeNull();
    signedInWith({ from: "nl", to: "en" });
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("nl>en | en-nl | en>nl"));
  });

  it("goes back to what it was if it cannot be saved", async () => {
    signedInWith({ from: "en", to: "nl" });
    mock.handlers["PATCH /settings"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
    await user.click(screen.getByRole("button", { name: "English to French" }));
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
  });

  it("keeps the pair when only the direction changes", async () => {
    signedInWith({ from: "en", to: "nl" });
    const user = userEvent.setup();
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
    await user.click(screen.getByRole("button", { name: "Dutch to English" }));
    expect(now()).toBe("nl>en | en-nl | en>nl");
    await waitFor(() => expect(saved).toEqual([{ direction: { from: "nl", to: "en" } }]));
  });

  it("ignores a language that is not supported, and the same language twice", async () => {
    signedInWith({ from: "en", to: "nl" });
    const user = userEvent.setup();
    wrap(<Switcher />);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
    await user.click(screen.getByRole("button", { name: "Nonsense" }));
    await user.click(screen.getByRole("button", { name: "Same" }));
    expect(now()).toBe("en>nl | en-nl | nl>en");
    expect(saved).toEqual([]);
  });

  it("falls back to the default when the account has a language the app does not offer", async () => {
    signedInWith({ from: "en", to: "fr" });
    wrap(<Switcher />, ["en", "nl"]);
    await waitFor(() => expect(now()).toBe("en>nl | en-nl | nl>en"));
  });
});

describe("each language pair keeps its own filters", () => {
  beforeEach(() => {
    mock.loggedIn = true;
    mock.handlers["PATCH /settings"] = (body) => json(200, { direction: (body as { direction: unknown }).direction });
  });
  function Filters() {
    const { setDirection } = useActiveLanguages();
    const [query, setQuery] = useRemembered("deck:query", "", isString);
    const filter = useDeckFilter(undefined);
    return (
      <div>
        <p data-testid="query">{query || "(none)"}</p>
        <p data-testid="direction">{filter.selected ? `${filter.selected.from}>${filter.selected.to}` : "(both)"}</p>
        <button onClick={() => setQuery("hond")}>Search</button>
        <button onClick={() => filter.select({ from: "nl", to: "en" })}>Pick Dutch to English</button>
        <button onClick={() => setDirection({ from: "en", to: "fr" })}>French</button>
        <button onClick={() => setDirection({ from: "en", to: "nl" })}>Dutch</button>
      </div>
    );
  }

  it("shows the search of the pair you switch to, and brings yours back when you return", async () => {
    const user = userEvent.setup();
    wrap(<Filters />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByTestId("query")).toHaveTextContent("hond");

    await user.click(screen.getByRole("button", { name: "French" }));
    expect(screen.getByTestId("query")).toHaveTextContent("(none)");

    await user.click(screen.getByRole("button", { name: "Dutch" }));
    expect(screen.getByTestId("query")).toHaveTextContent("hond");
  });

  it("remembers the direction shown for each pair separately", async () => {
    const user = userEvent.setup();
    wrap(<Filters />);
    await user.click(screen.getByRole("button", { name: "Pick Dutch to English" }));
    expect(screen.getByTestId("direction")).toHaveTextContent("nl>en");

    await user.click(screen.getByRole("button", { name: "French" }));
    expect(screen.getByTestId("direction")).toHaveTextContent("(both)");

    await user.click(screen.getByRole("button", { name: "Dutch" }));
    expect(screen.getByTestId("direction")).toHaveTextContent("nl>en");
    expect(localStorage.getItem("dashboardDirection:en-nl")).not.toBeNull();
    expect(localStorage.getItem("dashboardDirection:en-fr")).toBeNull();
  });
});

describe("every request about the deck is for the pair", () => {
  const summary = (total: number) => ({ total, new: total, learning: 0, relearning: 0, review: 0, dueNow: 0 });
  const pairOfLastRequest = () => /pair=([^&]+)/.exec(mock.requests.at(-1)!)?.[1];
  const directions = (pair: string): DirectionSummary[] =>
    pair === "en-nl"
      ? [{ fromLanguage: "en", toLanguage: "nl", total: 4 }]
      : [];

  beforeEach(() => {
    mock.loggedIn = true;
    mock.handlers["PATCH /settings"] = (body) => json(200, { direction: (body as { direction: unknown }).direction });
    // Each deck is its own: four cards in English to Dutch, none in English to French.
    mock.handlers["GET /deck?limit=1"] = () => json(200, { summary: summary(pairOfLastRequest() === "en-nl" ? 4 : 0) });
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: pairOfLastRequest() === "en-nl" ? 4 : 0 }, tomorrow: 0 });
    mock.handlers["GET /stats"] = () =>
      json(200, { now: "x", nextDueAt: null, directions: directions(pairOfLastRequest()!) });
  });

  it("asks for the deck, the counts and the stats of the pair", async () => {
    wrap(<DashboardPage />);
    expect((await screen.findAllByRole("link", { name: /^Start studying/ }))[0]!).toBeInTheDocument();
    for (const path of ["/deck?limit=1", "/study/counts", "/stats"]) {
      expect(mock.requests.some((r) => r.startsWith(`GET ${path}`) && r.includes("pair=en-nl")), path).toBe(true);
    }
    // The pair is always spelled the same way, whichever direction is being learned.
    expect(mock.requests.every((r) => !r.includes("pair=nl-en"))).toBe(true);
  });

  it("shows another pair's deck, not the old one, after switching", async () => {
    const user = userEvent.setup();
    wrap(
      <>
        <Switcher />
        <DashboardPage />
      </>,
    );
    expect((await screen.findAllByRole("link", { name: /^Start studying/ }))[0]!).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "English to French" }));
    // The French deck is empty, so the page greets someone starting out and the old counts are gone.
    expect(await screen.findByText("Your deck is empty")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Start studying/ })).not.toBeInTheDocument();
    await waitFor(() => expect(mock.requests.some((r) => r.startsWith("GET /study/counts") && r.includes("pair=en-fr"))).toBe(true));

    // Back again: the Dutch deck is there as it was.
    await user.click(screen.getByRole("button", { name: "Dutch to English" }));
    expect((await screen.findAllByRole("link", { name: /^Start studying/ }))[0]!).toBeInTheDocument();
  });
});

describe("changing the language pair or direction", () => {
  function Page() {
    const { setDirection } = useActiveLanguages();
    const [n, setN] = useState(0);
    return (
      <div>
        <p data-testid="count">{n}</p>
        <button onClick={() => setN(n + 1)}>Count</button>
        <button onClick={() => setDirection({ from: "nl", to: "en" })}>Flip</button>
      </div>
    );
  }

  it("starts the page afresh, so nothing of the last deck is left on it", async () => {
    mock.loggedIn = true;
    mock.handlers["PATCH /settings"] = (body) => json(200, { direction: (body as { direction: unknown }).direction });
    const user = userEvent.setup();
    wrap(
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Page />} />
        </Route>
      </Routes>,
    );
    await user.click(await screen.findByRole("button", { name: "Count" }));
    await user.click(screen.getByRole("button", { name: "Count" }));
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: "Flip" }));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
  });
});
