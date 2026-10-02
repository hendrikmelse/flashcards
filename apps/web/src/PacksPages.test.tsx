import { screen, waitFor, within } from "@testing-library/react";
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
  mock.handlers[`GET /packs/p1?${EN_NL}&limit=1000`] = () => json(200, packDetail());
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

  it("filters packs by name or description as you type", async () => {
    const user = userEvent.setup();
    renderApp("/packs");
    await screen.findByRole("link", { name: "Sample pack" });
    const box = screen.getByRole("searchbox", { name: "Search packs" });

    await user.type(box, "demo");
    expect(screen.getByRole("link", { name: "Sample pack" })).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "zebra");
    expect(screen.queryByRole("link", { name: "Sample pack" })).not.toBeInTheDocument();
    expect(screen.getByText(/No packs match/)).toBeInTheDocument();
  });

  it("lists name matches before packs that only match in the description", async () => {
    const user = userEvent.setup();
    const pack = (id: string, name: string, description: string) => ({
      id, slug: id, name, description, conceptCount: 1, availableCount: 1, addedCount: 0,
    });
    mock.handlers[`GET /packs?${EN_NL}`] = () =>
      json(200, {
        packs: [
          pack("a", "Animals", "Includes a few things you eat, like fish"),
          pack("b", "Cooking", "Verbs for the kitchen"),
          pack("c", "Food", "Everyday food"),
          pack("d", "Fish and sea", "Sea life"),
        ],
      });
    renderApp("/packs");
    await screen.findByRole("link", { name: "Cooking" });

    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "fish");

    const names = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(["Fish and sea", "Animals"]);
  });

  it("shows an error when packs cannot be loaded", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () => json(500, { error: "boom" });
    renderApp("/packs");
    expect(await screen.findByText(/Could not load packs/)).toBeInTheDocument();
  });
});

describe("word search", () => {
  const word = (id: string, en: string, nl: string, inDeckNow = false) => ({
    conceptId: id,
    entries: [entry("en", en), entry("nl", nl, { article: "de" })],
    inDeck: inDeckNow,
  });
  const lastSearch = () => mock.calls.filter((c) => c.startsWith("GET /concepts/search")).at(-1)!;

  async function openWords(user: ReturnType<typeof userEvent.setup>) {
    renderApp("/packs");
    await screen.findByRole("link", { name: "Sample pack" });
    await user.click(screen.getByRole("button", { name: "Words" }));
    return screen.getByRole("searchbox", { name: "Search words" });
  }

  it("asks for a longer term, then lists matches and adds one", async () => {
    const user = userEvent.setup();
    let added = false;
    mock.handlers["GET /concepts/search"] = () =>
      json(200, { concepts: [word("c9", "dog", "hond", added)], hasMore: false });
    mock.handlers["POST /concepts/c9/add"] = () => {
      added = true;
      return json(201, { added: 1, alreadyInDeck: 0 });
    };

    const box = await openWords(user);
    expect(screen.getByText(/at least two letters/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sample pack" })).not.toBeInTheDocument();

    await user.type(box, "hond");
    expect(await screen.findByText("de hond")).toBeInTheDocument();
    expect(lastSearch()).toContain("q=hond");

    await user.click(screen.getByRole("button", { name: "Add dog to my deck" }));
    expect(await screen.findByText("In deck")).toBeInTheDocument();
  });

  it("keeps a word you just added while hiding added results, until the filter changes", async () => {
    const user = userEvent.setup();
    let added = false;
    mock.handlers["GET /concepts/search"] = () =>
      json(200, { concepts: added ? [] : [word("c9", "dog", "hond")], hasMore: false });
    mock.handlers["POST /concepts/c9/add"] = () => {
      added = true;
      return json(201, { added: 1, alreadyInDeck: 0 });
    };

    const box = await openWords(user);
    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
    await user.type(box, "hond");
    await user.click(await screen.findByRole("button", { name: "Add dog to my deck" }));

    expect(lastSearch()).toContain("hideInDeck=1");
    expect(await screen.findByText("In deck")).toBeInTheDocument();
    // The server no longer returns it, but it stays put.
    expect(screen.getByText("de hond")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
    await waitFor(() => expect(screen.queryByText("de hond")).not.toBeInTheDocument());
  });

  it("loads more matches on request", async () => {
    const user = userEvent.setup();
    mock.handlers["GET /concepts/search"] = () =>
      lastSearch().includes("offset=0")
        ? json(200, { concepts: [word("c1", "do", "doen")], hasMore: true })
        : json(200, { concepts: [word("c2", "dog", "hond")], hasMore: false });

    const box = await openWords(user);
    await user.type(box, "do");
    expect(await screen.findByText("de doen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more matches" }));
    expect(await screen.findByText("de hond")).toBeInTheDocument();
    expect(screen.getByText("de doen")).toBeInTheDocument();
    expect(lastSearch()).toContain("offset=50");
    expect(screen.queryByRole("button", { name: "Load more matches" })).not.toBeInTheDocument();
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

    // The spinner holds the request for a moment, so wait for the message itself.
    expect(await screen.findByText(/Added 2 new cards/)).toHaveTextContent(
      "Added 2 new cards. 1 already in your deck. 1 not available in this direction yet.",
    );
    expect(await screen.findByRole("button", { name: "All words added" })).toBeDisabled();
  });

  it("explains when the pack does not exist", async () => {
    mock.handlers[`GET /packs/nope?${EN_NL}&limit=1000`] = () =>
      json(404, { error: "Pack not found" });
    renderApp(`/packs/nope?from=en&to=nl`);
    expect(await screen.findByText("That pack was not found.")).toBeInTheDocument();
  });

  it("shows every word of a large pack at once", async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        conceptId: `w${start + i}`,
        position: start + i,
        available: true,
        inDeck: false,
        entries: [entry("en", `word${start + i}`), entry("nl", `woord${start + i}`)],
      }));
    const pack = { id: "p1", slug: "sample", name: "Sample pack", description: null };
    mock.handlers[`GET /packs/p1?${EN_NL}&limit=1000`] = () =>
      json(200, { pack, concepts: page(0, 53) });

    renderApp(`/packs/p1?from=en&to=nl`);
    expect(await screen.findByText("word52")).toBeInTheDocument();
    expect(screen.getByText("word0")).toBeInTheDocument();
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
