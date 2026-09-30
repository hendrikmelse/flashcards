import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

const EN_NL = "fromLanguage=en&toLanguage=nl";
const NL_EN = "fromLanguage=nl&toLanguage=en";

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: "noun",
  details,
});

// Mutable fixture so adding a word changes what the next fetch returns.
let inDeck: Set<string>;

const concepts = [
  { conceptId: "c1", position: 0, available: true, entries: [entry("en", "dog"), entry("nl", "hond", { article: "de" })] },
  { conceptId: "c2", position: 1, available: true, entries: [entry("en", "house"), entry("nl", "huis", { article: "het" })] },
  { conceptId: "c3", position: 2, available: true, entries: [entry("en", "water"), entry("nl", "water", { article: "het" })] },
  { conceptId: "c4", position: 3, available: false, entries: [entry("en", "orphan")] },
];

const packDetail = () => ({
  pack: { id: "p1", slug: "sample", name: "Sample pack", description: "Demo data" },
  concepts: concepts.map((c) => ({ ...c, inDeck: inDeck.has(c.conceptId) })),
});

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  inDeck = new Set(["c1"]);

  mock.handlers[`GET /packs?${EN_NL}`] = () =>
    json(200, {
      packs: [
        {
          id: "p1",
          slug: "sample",
          name: "Sample pack",
          description: "Demo data",
          conceptCount: 4,
          availableCount: 3,
          addedCount: inDeck.size,
        },
      ],
    });
  mock.handlers[`GET /packs?${NL_EN}`] = () =>
    json(200, {
      packs: [
        { id: "p1", slug: "sample", name: "Sample pack", description: null, conceptCount: 4, availableCount: 0, addedCount: 0 },
      ],
    });
  mock.handlers[`GET /packs/p1?${EN_NL}&limit=50&offset=0`] = () => json(200, packDetail());
  mock.handlers["POST /concepts/c2/add"] = () => {
    inDeck.add("c2");
    return json(201, { added: 1, alreadyInDeck: 0 });
  };
  mock.handlers["POST /packs/p1/add"] = () => {
    inDeck.add("c2").add("c3");
    return json(200, { added: 2, alreadyInDeck: 1, unavailable: 1 });
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("pack list", () => {
  it("is reachable from the nav and shows progress in the chosen direction", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Packs" }));

    expect(await screen.findByRole("heading", { name: "Packs" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Sample pack" })).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 words in your deck/)).toBeInTheDocument();
    expect(screen.getByText(/1 not available in this direction yet/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Prompt language" })).toHaveValue("en");
    expect(screen.getByRole("combobox", { name: "Answer language" })).toHaveValue("nl");
  });

  it("re-queries when the direction is swapped, and remembers it", async () => {
    const user = userEvent.setup();
    renderApp("/packs");
    await screen.findByRole("link", { name: "Sample pack" });

    await user.click(screen.getByRole("button", { name: "Swap languages" }));

    expect(await screen.findByText(/No words available in this direction yet/)).toBeInTheDocument();
    expect(mock.calls).toContain(`GET /packs?${NL_EN}`);
    expect(screen.getByRole("combobox", { name: "Prompt language" })).toHaveValue("nl");
    expect(JSON.parse(localStorage.getItem("direction")!)).toEqual({ from: "nl", to: "en" });
  });

  it("swaps instead of allowing the same language on both sides", async () => {
    const user = userEvent.setup();
    renderApp("/packs");
    await screen.findByRole("link", { name: "Sample pack" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Prompt language" }), "nl");

    expect(screen.getByRole("combobox", { name: "Prompt language" })).toHaveValue("nl");
    expect(screen.getByRole("combobox", { name: "Answer language" })).toHaveValue("en");
  });

  it("uses a direction from the URL", async () => {
    renderApp("/packs?from=nl&to=en");
    await screen.findByText(/No words available in this direction yet/);
    expect(screen.getByRole("combobox", { name: "Prompt language" })).toHaveValue("nl");
  });

  it("shows an error when packs cannot be loaded", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () => json(500, { error: "boom" });
    renderApp("/packs");
    expect(await screen.findByText(/Could not load packs/)).toBeInTheDocument();
  });
});

describe("pack detail", () => {
  it("lists words with articles and per-word status", async () => {
    renderApp(`/packs/p1?from=en&to=nl`);
    expect(await screen.findByRole("heading", { name: "Sample pack" })).toBeInTheDocument();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("dog→de hond");
    expect(within(items[0]!).getByText("In deck")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("house→het huis");
    expect(within(items[1]!).getByRole("button", { name: "Add house to my deck" })).toBeInTheDocument();
    expect(items[3]).toHaveTextContent("orphan→—");
    expect(within(items[3]!).getByText("Not available yet")).toBeInTheDocument();
  });

  it("adds a single word and updates its status", async () => {
    const user = userEvent.setup();
    renderApp(`/packs/p1?from=en&to=nl`);
    await user.click(await screen.findByRole("button", { name: "Add house to my deck" }));

    expect(mock.calls).toContain("POST /concepts/c2/add");
    const house = (await screen.findAllByRole("listitem"))[1]!;
    expect(await within(house).findByText("In deck")).toBeInTheDocument();
  });

  it("adds the whole pack and reports what happened", async () => {
    const user = userEvent.setup();
    renderApp(`/packs/p1?from=en&to=nl`);
    await user.click(await screen.findByRole("button", { name: "Add all to my deck" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Added 2 new cards. 1 already in your deck. 1 not available in this direction yet.",
    );
    expect(await screen.findByRole("button", { name: "All words added" })).toBeDisabled();
  });

  it("explains when the pack does not exist", async () => {
    mock.handlers[`GET /packs/nope?${EN_NL}&limit=50&offset=0`] = () =>
      json(404, { error: "Pack not found" });
    renderApp(`/packs/nope?from=en&to=nl`);
    expect(await screen.findByText("That pack was not found.")).toBeInTheDocument();
  });

  it("loads more words a page at a time", async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        conceptId: `w${start + i}`,
        position: start + i,
        available: true,
        inDeck: false,
        entries: [entry("en", `word${start + i}`), entry("nl", `woord${start + i}`)],
      }));
    const pack = { id: "p1", slug: "sample", name: "Sample pack", description: null };
    mock.handlers[`GET /packs/p1?${EN_NL}&limit=50&offset=0`] = () =>
      json(200, { pack, concepts: page(0, 50) });
    mock.handlers[`GET /packs/p1?${EN_NL}&limit=50&offset=50`] = () =>
      json(200, { pack, concepts: page(50, 3) });

    const user = userEvent.setup();
    renderApp(`/packs/p1?from=en&to=nl`);
    await screen.findByText("word49");
    expect(screen.queryByText("word50")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("word52")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("dashboard link", () => {
  it("points new users with an empty deck to the packs", async () => {
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 } });
    mock.handlers["GET /study?limit=1"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Browse packs" })).toHaveAttribute("href", "/packs");
  });
});
