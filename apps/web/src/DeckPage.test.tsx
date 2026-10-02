import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: "noun",
  details,
});

const card = (id: string, en: string, nl: string, extra: Record<string, unknown> = {}) => ({
  id,
  conceptId: `c-${id}`,
  fromLanguage: "en",
  toLanguage: "nl",
  state: "new",
  dueAt: at(0),
  addedAt: at(-DAY),
  intervalDays: 0,
  lapses: 0,
  lastReviewedAt: null,
  front: [entry("en", en)],
  back: [entry("nl", nl, { article: "de" })],
  ...extra,
});

const summary = { total: 12, new: 5, learning: 2, relearning: 1, review: 4, dueNow: 3 };
const lastList = () => mock.calls.filter((c) => c.startsWith("GET /deck?limit=50")).at(-1)!;

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  localStorage.removeItem("dashboardDirection");
  mock.handlers["GET /deck"] = () =>
    json(200, {
      summary,
      hasMore: false,
      cards: [
        card("a", "dog", "hond"),
        card("b", "house", "huis", { state: "review", dueAt: at(3 * DAY + 3_600_000), intervalDays: 12, lapses: 2 }),
        card("c", "water", "water", { state: "learning", dueAt: at(-60_000) }),
        card("d", "cat", "kat", { state: "relearning", dueAt: at(-60_000), lapses: 1 }),
      ],
    });
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard link", () => {
  it("has a button that opens the deck", async () => {
    renderApp("/");
    expect(await screen.findByRole("link", { name: "View deck" })).toHaveAttribute("href", "/deck");
  });
});

describe("deck page", () => {
  it("lists each card with its status and when it is due", async () => {
    renderApp("/deck");
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("dog→de hond");
    expect(rows[0]).toHaveTextContent("New");
    expect(rows[0]).toHaveTextContent("Not studied yet");
    expect(rows[1]).toHaveTextContent("Review");
    expect(rows[1]).toHaveTextContent("Due in 3 days");
    expect(rows[1]).toHaveTextContent("12 days interval · 2 lapses");
    expect(rows[2]).toHaveTextContent("Learning");
    expect(rows[2]).toHaveTextContent("Due now");
    expect(rows[3]).toHaveTextContent("Relearning");
    expect(rows[3]).toHaveTextContent("1 lapse");
    expect(screen.getByText("12 cards")).toBeInTheDocument();
  });

  it("has a button to add more words", async () => {
    renderApp("/deck");
    expect(await screen.findByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/packs");
  });

  it("shows how many cards are in each stage, counting relearning as learning", async () => {
    renderApp("/deck");
    const stages = await screen.findByRole("group", { name: "Status" });
    expect(within(stages).getByRole("button", { name: /All/ })).toHaveTextContent("12");
    expect(within(stages).getByRole("button", { name: /New/ })).toHaveTextContent("5");
    expect(within(stages).getByRole("button", { name: /Learning/ })).toHaveTextContent("3");
    expect(within(stages).getByRole("button", { name: /Review/ })).toHaveTextContent("4");
  });

  it("filters by stage, soonest due first for studied stages", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.click(await screen.findByRole("button", { name: /Review/ }));
    await screen.findAllByRole("listitem");
    expect(lastList()).toContain("state=review");
    expect(lastList()).toContain("sort=due&order=asc");

    await user.click(screen.getByRole("button", { name: /New/ }));
    await screen.findAllByRole("listitem");
    expect(lastList()).toContain("state=new");
    expect(lastList()).toContain("sort=added&order=desc");
  });

  it("starts newest first, and lets you pick another sort", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const select = await screen.findByRole("combobox", { name: "Sort by" });
    expect(select).toHaveValue("added");
    expect(lastList()).toContain("sort=added&order=desc");

    for (const [value, order] of [
      ["due", "asc"],
      ["status", "asc"],
      ["interval", "desc"],
      ["lapses", "desc"],
      ["alpha", "asc"],
    ] as const) {
      await user.selectOptions(select, value);
      await vi.waitFor(() => expect(lastList()).toContain(`sort=${value}&order=${order}`));
    }
  });

  it("reverses the order, and goes back to the natural order when the sort changes", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const select = await screen.findByRole("combobox", { name: "Sort by" });
    await user.selectOptions(select, "interval");
    await user.click(await screen.findByRole("button", { name: /Reverse order, currently Longest first/ }));
    await vi.waitFor(() => expect(lastList()).toContain("sort=interval&order=asc"));
    expect(screen.getByRole("button", { name: /currently Shortest first/ })).toBeInTheDocument();

    await user.selectOptions(select, "alpha");
    await vi.waitFor(() => expect(lastList()).toContain("sort=alpha&order=asc"));
    expect(screen.getByRole("button", { name: /currently A to Z/ })).toBeInTheDocument();
  });

  it("keeps a sort you chose when the stage changes", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sort by" }), "alpha");
    await user.click(screen.getByRole("button", { name: /Review/ }));
    await vi.waitFor(() => expect(lastList()).toContain("state=review"));
    expect(lastList()).toContain("sort=alpha");
  });

  it("searches the deck", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.type(await screen.findByRole("searchbox", { name: "Search your deck" }), "hond");
    await vi.waitFor(() => expect(lastList()).toContain("q=hond"));
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await screen.findAllByRole("listitem");
    mock.handlers["GET /deck"] = () => json(200, { summary, hasMore: false, cards: [] });
    await user.type(screen.getByRole("searchbox", { name: "Search your deck" }), "zzz");
    expect(await screen.findByText("No cards match.")).toBeInTheDocument();
  });

  it("narrows to one direction with the toggle, and labels the direction when showing both", async () => {
    const dir = (from: string, to: string) => ({
      fromLanguage: from, toLanguage: to, total: 6, new: 3, learning: 1, review: 2, dueNow: 1, nextDueAt: null,
    });
    mock.handlers["GET /stats"] = () =>
      json(200, { now: at(0), reviewsToday: 0, nextDueAt: null, directions: [dir("en", "nl"), dir("nl", "en")] });
    const user = userEvent.setup();
    renderApp("/deck");
    expect(await screen.findAllByText("EN → NL")).not.toHaveLength(0); // tag on each row, and the toggle

    await user.click(await screen.findByRole("button", { name: "NL → EN" }));
    await vi.waitFor(() => expect(lastList()).toContain("fromLanguage=nl&toLanguage=en"));
    expect(screen.getByRole("button", { name: "NL → EN" })).toHaveAttribute("aria-pressed", "true");
  });

  it("always shows the whole deck's size at the top, whichever direction is selected", async () => {
    const dir = (from: string, to: string, total: number) => ({
      fromLanguage: from, toLanguage: to, total, new: total, learning: 0, review: 0, dueNow: 0, nextDueAt: null,
    });
    mock.handlers["GET /stats"] = () =>
      json(200, { now: at(0), reviewsToday: 0, nextDueAt: null, directions: [dir("en", "nl", 300), dir("nl", "en", 66)] });
    // The list's own summary is for the selected direction only.
    mock.handlers["GET /deck"] = () =>
      json(200, { summary: { ...summary, total: 66 }, hasMore: false, cards: [card("a", "dog", "hond")] });
    const user = userEvent.setup();
    renderApp("/deck");
    expect(await screen.findByText("366 cards")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "NL → EN" }));
    await vi.waitFor(() => expect(lastList()).toContain("fromLanguage=nl&toLanguage=en"));
    expect(screen.getByText("366 cards")).toBeInTheDocument();
  });

  it("loads more cards on request", async () => {
    mock.handlers["GET /deck"] = () =>
      lastList().includes("offset=0") || !lastList().includes("offset=")
        ? json(200, { summary, hasMore: true, cards: [card("a", "dog", "hond")] })
        : json(200, { summary, hasMore: false, cards: [card("b", "house", "huis")] });
    const user = userEvent.setup();
    renderApp("/deck");
    await screen.findByText("dog");
    await user.click(screen.getByRole("button", { name: "Load more cards" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(screen.getByText("dog")).toBeInTheDocument();
    expect(lastList()).toContain("offset=50");
    expect(screen.queryByRole("button", { name: "Load more cards" })).not.toBeInTheDocument();
  });

  it("points an empty deck at the packs", async () => {
    mock.handlers["GET /deck"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 }, hasMore: false, cards: [] });
    renderApp("/deck");
    expect(await screen.findByText("Your deck is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse packs" })).toHaveAttribute("href", "/packs");
  });

  it("shows an error when the deck cannot be loaded", async () => {
    mock.handlers["GET /deck"] = () => json(500, { error: "boom" });
    renderApp("/deck");
    expect(await screen.findByText(/Could not load your deck/)).toBeInTheDocument();
  });
});
