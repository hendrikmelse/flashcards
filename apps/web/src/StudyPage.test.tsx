import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp, sentence } from "./test/harness";

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: null,
  details,
});

const dog = {
  id: "card-dog",
  conceptId: "c1",
  fromLanguage: "en",
  toLanguage: "nl",
  state: "new",
  dueAt: "2026-01-01T00:00:00.000Z",
  front: [entry("en", "dog")],
  back: [entry("nl", "hond", { article: "de" })],
  sentences: { front: ["The dog barks."], back: ["De hond blaft."] },
};
const house = {
  ...dog,
  id: "card-house",
  conceptId: "c2",
  front: [entry("en", "house")],
  back: [entry("nl", "huis", { article: "het" })],
  sentences: { front: [], back: [] },
};

type Body = { userCardId: string; rating: string; clientReviewId: string; timeTakenMs: number };
let reviews: Body[];
let studyCalls = 0;

// What the server answers to a review: learning (back in 10 min) or graduated.
const learning = (id: string) => ({
  userCardId: id,
  state: "learning",
  intervalDays: 0,
  reviewedAt: "2026-01-01T12:00:00.000Z",
  dueAt: "2026-01-01T12:10:00.000Z",
  replayed: false,
});
const graduated = (id: string) => ({
  userCardId: id,
  state: "review",
  intervalDays: 8,
  reviewedAt: "2026-01-01T12:00:00.000Z",
  dueAt: "2026-01-09T12:00:00.000Z",
  replayed: false,
});

function studyWith(cards: unknown[]) {
  mock.handlers["GET /study?limit=100"] = () => {
    studyCalls++;
    return json(200, { now: "x", counts: { learning: 0, review: 0, new: cards.length }, cards });
  };
}

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  reviews = [];
  studyCalls = 0;
  studyWith([dog, house]);
  mock.handlers["POST /reviews"] = (body) => {
    const b = body as Body;
    reviews.push(b);
    return json(200, b.rating === "easy" ? graduated(b.userCardId) : learning(b.userCardId));
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("ending a session early", () => {
  it("shows the session complete screen instead of going back to the dashboard", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    // dog: Good (still learning, so it will come back in a later session). Then stop.
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByText("house");
    await user.click(screen.getByRole("button", { name: "End session" }));

    expect(await screen.findByRole("heading", { name: "Session complete!" })).toBeInTheDocument();
    expect(screen.getByText("You viewed 1 unique card")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to the dashboard" });
    expect(back).toHaveAttribute("href", "/");
    expect(back).toHaveClass("button", "primary"); // looks and works like the other page buttons
    expect(screen.getByText("Good").nextSibling).toHaveTextContent("1");
    // Still on the study page: nothing sent you away, and the card is gone.
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByText("house")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();
  });

  it("is a button, not a link", async () => {
    renderApp("/study");
    const end = await screen.findByRole("button", { name: "End session" });
    expect(end.tagName.toLowerCase()).toBe("button");
    expect(screen.queryByRole("link", { name: "End session" })).not.toBeInTheDocument();
  });

  it("goes straight back to the dashboard when nothing was answered, with no summary", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Session complete!" })).not.toBeInTheDocument();
    expect(reviews).toEqual([]);
  });

  it("does the same when a card was looked at but not answered", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText(/Session complete/)).not.toBeInTheDocument();
  });

  it("does the same from the explanation shown in a first session", async () => {
    mock.handlers["GET /study?limit=100"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 2 }, cards: [dog, house], firstSession: true });
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("article", { name: "How studying works" });
    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("counts a missed card that was still waiting its turn as one to look at again", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Again" })); // dog goes back behind house
    await screen.findByText("house");
    await user.click(screen.getByRole("button", { name: "End session" }));

    expect(await screen.findByText("You viewed 1 unique card")).toBeInTheDocument();
  });

  it("stops asking for more cards once the session has ended", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" })); // something answered, so there is a summary
    await screen.findByText("house");
    const calls = studyCalls;
    await user.click(screen.getByRole("button", { name: "End session" }));
    await screen.findByRole("heading", { name: "Session complete!" });
    await new Promise((r) => setTimeout(r, 200));
    expect(studyCalls).toBe(calls);
  });

  it("can be done from the pause before a repeated card, which then counts as one to look at again", async () => {
    const user = userEvent.setup();
    studyWith([dog]);
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Again" }));
    expect(await screen.findByText(/exact same card again/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Session complete!" })).toBeInTheDocument();
    expect(screen.queryByText(/exact same card again/)).not.toBeInTheDocument();
    expect(screen.getByText("You viewed 1 unique card")).toBeInTheDocument();
  });
});

describe("language flags", () => {
  const flagIn = (region: string) => within(screen.getByRole("region", { name: region }));

  it("shows the flag of the language being shown, beside the prompt", async () => {
    renderApp("/study");
    expect(await screen.findByText("dog")).toBeInTheDocument();
    // The card is English to Dutch: the prompt is English.
    expect(flagIn("Prompt").getByRole("img", { name: "English" })).toBeInTheDocument();
    expect(flagIn("Prompt").queryByRole("img", { name: "Nederlands" })).not.toBeInTheDocument();
  });

  it("shows the answer's flag beside the answer once it is revealed", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByText("dog");
    expect(screen.queryByRole("region", { name: "Answer" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    expect(flagIn("Answer").getByRole("img", { name: "Nederlands" })).toBeInTheDocument();
    // The prompt keeps its own.
    expect(flagIn("Prompt").getByRole("img", { name: "English" })).toBeInTheDocument();
  });

  it("follows the direction of the card: Dutch to English shows the Dutch flag first", async () => {
    const user = userEvent.setup();
    const reverse = {
      ...dog,
      fromLanguage: "nl",
      toLanguage: "en",
      front: [entry("nl", "hond", { article: "de" })],
      back: [entry("en", "dog")],
    };
    studyWith([reverse]);
    renderApp("/study");
    await screen.findByText("de hond");
    expect(flagIn("Prompt").getByRole("img", { name: "Nederlands" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    expect(flagIn("Answer").getByRole("img", { name: "English" })).toBeInTheDocument();
  });

  it("is drawn as an image next to the word, and the two flags differ", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByText("dog");
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    const english = flagIn("Prompt").getByRole("img", { name: "English" });
    const dutch = flagIn("Answer").getByRole("img", { name: "Nederlands" });
    expect(english.tagName.toLowerCase()).toBe("svg");
    expect(english.nextElementSibling).toHaveClass("study-word");
    expect(english.innerHTML).not.toBe(dutch.innerHTML);
  });

  it("draws English as the Union Jack and Dutch as the Dutch flag", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByText("dog");
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    const english = flagIn("Prompt").getByRole("img", { name: "English" });
    const dutch = flagIn("Answer").getByRole("img", { name: "Nederlands" });
    // The Union Jack's navy and red, and none of the stars-and-stripes colors.
    expect(english.innerHTML).toContain("#012169");
    expect(english.innerHTML).toContain("#C8102E");
    expect(english.innerHTML).not.toContain("#B22234");
    // Red, white and blue stripes for the Netherlands.
    expect(dutch.innerHTML).toContain("#AE1C28");
    expect(dutch.innerHTML).toContain("#21468B");
  });

  it("shows the language code for a language without a flag", async () => {
    const user = userEvent.setup();
    const german = {
      ...dog,
      toLanguage: "de",
      back: [entry("de", "Hund")],
    };
    studyWith([german]);
    renderApp("/study");
    await screen.findByText("dog");
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    const code = flagIn("Answer").getByRole("img", { name: "DE" });
    expect(code).toHaveTextContent("DE");
  });
});

describe("missed cards", () => {
  it("come back after the other cards, with no pause and no waiting", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    // dog: Again. house is next; dog is placed behind it.
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Again" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(screen.queryByText(/exact same card/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 left/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Easy" }));

    // Straight to dog again, with no notice.
    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.queryByText("Nothing else is ready right now.")).not.toBeInTheDocument();
    expect(screen.queryByText(/exact same card/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show answer" })).toBeInTheDocument();
  });

  it("pause with a notice first when it would be the very same card again", async () => {
    studyWith([dog]);
    const user = userEvent.setup();
    renderApp("/study");

    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Again" }));

    expect(await screen.findByText(/You’re about to be shown the exact same card again!/)).toBeInTheDocument();
    expect(screen.getByText(/clear your mind, then click “Continue” when you’re ready/)).toBeInTheDocument();
    // The card itself is not showing yet.
    expect(screen.queryByRole("button", { name: "Show answer" })).not.toBeInTheDocument();
    expect(screen.queryByText("dog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show answer" })).toBeInTheDocument();
    expect(screen.queryByText(/exact same card/)).not.toBeInTheDocument();
  });
});

describe("the number of cards left", () => {
  const cat = { ...house, id: "card-cat", conceptId: "c3", front: [entry("en", "cat")], back: [entry("nl", "kat", { article: "de" })] };
  // Like the server: the first batch is dog and house, with `moreNew` more waiting behind the daily
  // limit. When the queue runs dry (the last card is on screen) it asks again, and gets what is still on
  // offer: house, which is already being shown, and, if an answer made room, one more.
  const withMoreNew = (moreNew: number, madeRoom = true) => {
    let calls = 0;
    mock.handlers["GET /study?limit=100"] = () => {
      calls++;
      const cards = calls === 1 ? [dog, house] : madeRoom && moreNew > 0 ? [house, cat] : [house];
      return json(200, {
        now: "x",
        counts: { learning: 0, review: 0, new: cards.length },
        cards,
        firstSession: false,
        moreNew: calls === 1 ? moreNew : Math.max(0, moreNew - 1),
      });
    };
  };

  it("does not count down when a new card is answered Good or Easy, as another new card is coming", async () => {
    withMoreNew(4);
    const user = userEvent.setup();
    renderApp("/study");
    expect(await screen.findByText(/2 left/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(screen.getByText(/2 left/)).toBeInTheDocument();
  });

  it("counts down when a new card is answered Hard, which uses up the daily limit", async () => {
    withMoreNew(4, false);
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Hard" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(screen.getByText(/1 left/)).toBeInTheDocument();
  });

  it("counts down as usual when there are no more new cards beyond the limit", async () => {
    withMoreNew(0);
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(screen.getByText(/1 left/)).toBeInTheDocument();
  });
});

describe("starting a session", () => {
  it("always studies the whole deck of the language pair: a direction in the address is ignored", async () => {
    renderApp("/study?from=nl&to=en");
    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(mock.calls).toContain("GET /study?limit=100");
    expect(mock.requests.some((r) => r.includes("fromLanguage") || r.includes("toLanguage"))).toBe(false);
    expect(mock.requests).toContain("GET /study?limit=100&pair=en-nl");
  });
});

describe("study session", () => {
  it("shows the prompt first and only reveals the answer on request", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.getByText(sentence("The dog barks."))).toBeInTheDocument();
    expect(screen.getByText(/English → Nederlands/)).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText("de hond")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show answer" }));

    expect(screen.getByText("de hond")).toBeInTheDocument();
    expect(screen.getByText(sentence("De hond blaft."))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
  });

  it("runs a session to the end, then shows the summary, with the cards still being learned", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    // dog: Good -> the server says learning (10 min). It will not come back in this session.
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    expect(reviews[0]).toMatchObject({ userCardId: "card-dog", rating: "good" });
    expect(reviews[0]!.clientReviewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reviews[0]!.timeTakenMs).toBeGreaterThanOrEqual(0);

    // house: Easy (by keyboard) -> graduates.
    expect(await screen.findByText("house")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    await user.keyboard("4");
    expect(reviews[1]).toMatchObject({ userCardId: "card-house", rating: "easy" });

    // Nothing is left to show now: the session is over.
    expect(await screen.findByRole("heading", { name: "Session complete!" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing else is ready right now.")).not.toBeInTheDocument();
    expect(screen.getByText("You viewed 2 unique cards")).toBeInTheDocument();
    expect(screen.queryByText(/rated Good or Easy/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
    expect(reviews).toHaveLength(2); // dog was not shown a second time
  });

  it("shows the session summary when every card is finished", async () => {
    const user = userEvent.setup();
    studyWith([dog]);
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Easy" }));

    expect(await screen.findByRole("heading", { name: "Session complete!" })).toBeInTheDocument();
    expect(screen.getByText("You viewed 1 unique card")).toBeInTheDocument();
    expect(screen.getByText("Easy").nextSibling).toHaveTextContent("1");
  });

  it("counts each card once however often it was shown", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    // dog: Again (comes back after house), then Good. house: Good.
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Again" }));
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));

    expect(await screen.findByRole("heading", { name: "Session complete!" })).toBeInTheDocument();
    expect(screen.getByText("You viewed 2 unique cards")).toBeInTheDocument(); // three answers, two cards
    expect(screen.getByText("Again").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Good").nextSibling).toHaveTextContent("2");
  });

  it("rates with the number keys", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.keyboard("1");
    expect(reviews[0]).toMatchObject({ rating: "again" });
  });

  it("ignores the number keys until the answer is showing", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("button", { name: "Show answer" });
    await user.keyboard("3");
    expect(reviews).toHaveLength(0);
  });

  it("lets Space/Enter act on the focused button (reveal, then Good)", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("button", { name: "Show answer" });
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Good" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(reviews[0]).toMatchObject({ rating: "good" });
  });

  it("keeps the card and retries with the same id when saving fails", async () => {
    let first = true;
    mock.handlers["POST /reviews"] = (body) => {
      const b = body as Body;
      reviews.push(b);
      if (first) {
        first = false;
        return json(500, { error: "boom" });
      }
      return json(200, graduated(b.userCardId));
    };
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your answer");
    expect(screen.getByText("dog")).toBeInTheDocument(); // still on the same card

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(reviews).toHaveLength(2);
    expect(reviews[1]!.clientReviewId).toBe(reviews[0]!.clientReviewId);
  });

  it("says you are caught up when nothing is due", async () => {
    studyWith([]);
    renderApp("/study");
    expect(await screen.findByText(/all caught up/)).toBeInTheDocument();
    const browse = screen.getByRole("link", { name: "Browse words" });
    expect(browse).toHaveAttribute("href", "/add-words");
    expect(browse).toHaveClass("button");
    const back = screen.getByRole("link", { name: "Back to the dashboard" });
    expect(back).toHaveAttribute("href", "/");
    expect(back).toHaveClass("button");
    expect(screen.queryByRole("link", { name: "Browse packs" })).not.toBeInTheDocument();
  });

  it("recovers from a failed load", async () => {
    mock.handlers["GET /study?limit=100"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/study");
    expect(await screen.findByText("Could not load your cards.")).toBeInTheDocument();

    studyWith([dog]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("dog")).toBeInTheDocument();
  });
});

describe("verb forms", () => {
  const walk = {
    ...dog,
    id: "card-walk",
    conceptId: "c3",
    front: [entry("en", "walk", { past: "walked", participle: "walked" })],
    back: [
      entry("nl", "lopen", {
        pastSingular: "liep",
        pastPlural: "liepen",
        participle: "gelopen",
        auxiliary: "hebben/zijn",
      }),
    ],
    sentences: { front: [], back: [] },
  };
  const be = {
    ...walk,
    id: "card-be",
    conceptId: "c4",
    front: [entry("nl", "zijn")],
    back: [
      entry("en", "be", {
        past: "was/were",
        participle: "been",
        // jsonb does not keep key order, so scramble it to prove the card sorts.
        present: { we: "are", he: "is", I: "am", you: "are" },
      }),
    ],
  };

  it("shows the forms on the back only", async () => {
    const user = userEvent.setup();
    studyWith([walk]);
    renderApp("/study");

    expect(await screen.findByText("walk")).toBeInTheDocument();
    expect(screen.queryByText("liep, liepen")).not.toBeInTheDocument();
    expect(screen.queryByText("walked")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show answer" }));

    expect(screen.getByText("liep, liepen")).toBeInTheDocument();
    expect(screen.getByText("heeft/is gelopen")).toBeInTheDocument();
  });

  it("does not show forms for the prompt side, even when it is a verb", async () => {
    const user = userEvent.setup();
    studyWith([{ ...walk, front: walk.back, back: walk.front }]);
    renderApp("/study");

    expect(await screen.findByText("lopen")).toBeInTheDocument();
    expect(screen.queryByText("liep, liepen")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    // The back is now the English verb: its forms appear, the Dutch ones do not.
    expect(screen.getAllByText("walked")).toHaveLength(2); // past and participle
    expect(screen.queryByText("liep, liepen")).not.toBeInTheDocument();
  });

  it("lists an irregular present tense in pronoun order", async () => {
    const user = userEvent.setup();
    studyWith([be]);
    renderApp("/study");

    await user.click(await screen.findByRole("button", { name: "Show answer" }));

    expect(screen.getByText("I am, you are, he is, we are")).toBeInTheDocument();
    expect(screen.getByText("was/were")).toBeInTheDocument();
    expect(screen.getByText("been")).toBeInTheDocument();
  });

  it("shows a noun's plural on the back only", async () => {
    const user = userEvent.setup();
    const hond = {
      ...dog,
      front: [entry("en", "dog", { plural: "dogs" })],
      back: [entry("nl", "hond", { article: "de", plural: "honden" })],
    };
    studyWith([hond]);
    renderApp("/study");

    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.queryByText("dogs")).not.toBeInTheDocument();
    expect(screen.queryByText("honden")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show answer" }));

    expect(screen.getByText("plural")).toBeInTheDocument();
    expect(screen.getByText("honden")).toBeInTheDocument();
    expect(screen.queryByText("dogs")).not.toBeInTheDocument();
  });

  describe("the display settings", () => {
    const hond = {
      ...dog,
      front: [entry("en", "dog", { plural: "dogs" })],
      back: [entry("nl", "hond", { article: "de", plural: "honden" })],
    };
    const accountSettings = (extra: Record<string, unknown>) => () =>
      json(200, {
        email: "ann@example.com",
        name: null,
        timezone: "UTC",
        dailyNewCardLimit: 20,
        showSentences: true,
        showForms: true,
        ...extra,
      });

    it("hide the example sentences on both sides when turned off in the account", async () => {
      mock.handlers["GET /settings"] = accountSettings({ showSentences: false });
      const user = userEvent.setup();
      studyWith([hond]);
      renderApp("/study");
      expect(await screen.findByText("dog")).toBeInTheDocument();
      expect(screen.queryByText(sentence("The dog barks."))).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Show answer" }));
      expect(screen.getByText("de hond")).toBeInTheDocument();
      expect(screen.queryByText(sentence("De hond blaft."))).not.toBeInTheDocument();
      // The word forms are a separate setting, so they still show.
      expect(screen.getByText("honden")).toBeInTheDocument();
    });

    it("hide the word forms when turned off, but keep the sentences", async () => {
      mock.handlers["GET /settings"] = accountSettings({ showForms: false });
      const user = userEvent.setup();
      studyWith([hond]);
      renderApp("/study");
      expect(await screen.findByText(sentence("The dog barks."))).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Show answer" }));
      expect(screen.getByText(sentence("De hond blaft."))).toBeInTheDocument();
      expect(screen.queryByText("plural")).not.toBeInTheDocument();
      expect(screen.queryByText("honden")).not.toBeInTheDocument();
    });

    it("show everything by default", async () => {
      const user = userEvent.setup();
      studyWith([hond]);
      renderApp("/study");
      expect(await screen.findByText(sentence("The dog barks."))).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Show answer" }));
      expect(screen.getByText(sentence("De hond blaft."))).toBeInTheDocument();
      expect(screen.getByText("honden")).toBeInTheDocument();
    });

    it("show everything if the settings cannot be loaded", async () => {
      mock.handlers["GET /settings"] = () => json(500, { error: "boom" });
      const user = userEvent.setup();
      studyWith([hond]);
      renderApp("/study");
      expect(await screen.findByText(sentence("The dog barks."))).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Show answer" }));
      expect(screen.getByText("honden")).toBeInTheDocument();
    });
  });

  it("says when a noun is uncountable", async () => {
    const user = userEvent.setup();
    studyWith([
      { ...dog, front: [entry("en", "money", { uncountable: true })], back: [entry("nl", "geld", { article: "het", uncountable: true })] },
    ]);
    renderApp("/study");

    await user.click(await screen.findByRole("button", { name: "Show answer" }));

    expect(screen.getByText("uncountable")).toBeInTheDocument();
  });

  it("says when a noun only exists in the plural", async () => {
    const user = userEvent.setup();
    studyWith([
      {
        ...dog,
        front: [entry("en", "people", { pluralOnly: true })],
        back: [entry("nl", "mensen", { article: "de", pluralOnly: true })],
      },
    ]);
    renderApp("/study");

    await user.click(await screen.findByRole("button", { name: "Show answer" }));

    expect(screen.getByText("plural only")).toBeInTheDocument();
  });

  it("adds nothing for words without forms", async () => {
    const user = userEvent.setup();
    studyWith([dog]);
    renderApp("/study");

    await user.click(await screen.findByRole("button", { name: "Show answer" }));

    expect(screen.queryByLabelText(/^Forms of/)).not.toBeInTheDocument();
  });
});

describe("dashboard entry point", () => {
  it("offers to start studying when cards are due", async () => {
    renderApp("/");
    expect((await screen.findAllByRole("link", { name: /^Start studying/ }))[0]!).toHaveAttribute("href", "/study");
  });

  it("says so when there is nothing to study", async () => {
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 }, cards: [] });
    renderApp("/");
    expect(await screen.findByText("No cards to study right now")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Start studying/ })).not.toBeInTheDocument();
  });
});

describe("the answer buttons", () => {
  const reveal = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(await screen.findByRole("button", { name: "Show answer" }));

  it("have no explanation under them: the study screen is just the card and the buttons", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    const buttons = screen.getByRole("group", { name: "How well did you know it?" });
    expect(within(buttons).getAllByRole("button").map((b) => b.textContent)).toEqual(["Again1", "Hard2", "Good3", "Easy4"]);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByText(/I didn.t remember it|How did it go/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Got it" })).not.toBeInTheDocument();
  });

  it("can be answered with the number keys", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    await user.keyboard("3");
    await vi.waitFor(() => expect(reviews.map((r) => r.rating)).toEqual(["good"]));
  });
});

describe("the first study session", () => {
  const firstSession = (cards: unknown[], first = true) => {
    let calls = 0;
    mock.handlers["GET /study?limit=100"] = () => {
      calls++;
      // Only the first request can be the first session: after that, cards have been answered.
      return json(200, { now: "x", counts: { learning: 0, review: 0, new: cards.length }, cards, firstSession: first && calls === 1 });
    };
  };

  it("opens with how studying works and what the buttons mean, in place of the first card", async () => {
    firstSession([dog, house]);
    renderApp("/study");
    const intro = within(await screen.findByRole("article", { name: "How studying works" }));
    expect(screen.queryByRole("button", { name: "Show answer" })).not.toBeInTheDocument();
    expect(screen.queryByText("dog")).not.toBeInTheDocument();
    for (const word of ["Again", "Hard", "Good", "Easy"]) expect(intro.getByText(word)).toBeInTheDocument();
    expect(intro.getByText("Show answer")).toBeInTheDocument();
    expect(intro.getByRole("link", { name: "More about scheduling" })).toHaveAttribute("href", "/how-it-works");
  });

  it("has a button to start, which is focused, and then shows the first card", async () => {
    firstSession([dog, house]);
    const user = userEvent.setup();
    renderApp("/study");
    const start = await screen.findByRole("button", { name: "Start studying" });
    expect(start).toHaveFocus();
    await user.click(start);
    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "How studying works" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show answer" })).toBeInTheDocument();
  });

  it("is not shown again for the rest of the session", async () => {
    firstSession([dog, house]);
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Start studying" }));
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByText("house");
    expect(screen.queryByRole("article", { name: "How studying works" })).not.toBeInTheDocument();
  });

  it("is not shown to anyone who has studied before", async () => {
    firstSession([dog, house], false);
    renderApp("/study");
    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "How studying works" })).not.toBeInTheDocument();
  });

  it("is not shown when there is nothing to study", async () => {
    firstSession([]);
    renderApp("/study");
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "How studying works" })).not.toBeInTheDocument();
  });

  it("does not take the number keys until it has been dismissed", async () => {
    firstSession([dog, house]);
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("article", { name: "How studying works" });
    await user.keyboard("3");
    expect(reviews).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Start studying" }));
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.keyboard("3");
    await vi.waitFor(() => expect(reviews).toHaveLength(1));
  });
});

describe("reporting a problem with a card", () => {
  type Report = { fromLanguage: string; toLanguage: string; reason: string; note: string };
  let reports: Report[];
  beforeEach(() => {
    reports = [];
    mock.handlers["POST /concepts/c1/report"] = (body) => {
      reports.push(body as Report);
      return json(201, { ok: true });
    };
  });
  const reveal = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(await screen.findByRole("button", { name: "Show answer" }));

  it("is offered once the answer is showing", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("button", { name: "Show answer" });
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
    await reveal(user);
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
  });

  it("sends the reason and details for the word, in the direction shown, then says thanks", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    const form = within(screen.getByRole("form", { name: "Report a problem" }));
    await user.selectOptions(form.getByLabelText("What is wrong?"), "The word forms are wrong");
    await user.type(form.getByLabelText(/Details/), "The plural is honden");
    await user.click(form.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Thanks! We’ll take a look.")).toBeInTheDocument();
    expect(reports).toEqual([
      { fromLanguage: "en", toLanguage: "nl", reason: "forms", note: "The plural is honden" },
    ]);
    expect(screen.queryByRole("form", { name: "Report a problem" })).not.toBeInTheDocument();
  });

  it("can be sent without details, except for “Something else”", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    const send = screen.getByRole("button", { name: "Send report" });
    expect(send).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("What is wrong?"), "Something else");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Details"), "Hmm");
    expect(send).toBeEnabled();
    await user.click(send);
    await screen.findByText("Thanks! We’ll take a look.");
    expect(reports[0]).toMatchObject({ reason: "other", note: "Hmm" });
  });

  it("can be cancelled, and typing in it does not answer the card", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(screen.getByLabelText("What is wrong?")).toHaveFocus();
    await user.type(screen.getByLabelText(/Details/), "1234");
    expect(reviews).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Report a problem" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report a problem" })).toHaveFocus();
    expect(reports).toEqual([]);
  });

  it("says so when it could not be sent, and keeps what was typed", async () => {
    mock.handlers["POST /concepts/c1/report"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    await user.type(screen.getByLabelText(/Details/), "Wrong");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("Could not send your report. Please try again.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Details/)).toHaveValue("Wrong");
  });

  it("starts fresh on the next card", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await reveal(user);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByText("house");
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
    expect(screen.queryByText("Thanks! We’ll take a look.")).not.toBeInTheDocument();
  });
});
