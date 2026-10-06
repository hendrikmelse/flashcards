import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

beforeEach(() => installMockApi());
afterEach(() => vi.unstubAllGlobals());

describe("auth flow", () => {
  it("redirects anonymous visitors to the login page", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("logs in and lands on the dashboard", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your deck" })).toBeInTheDocument();
  });

  it("has Dashboard, Study, My deck, and Add words in the main navigation", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Dashboard", "Study", "My deck", "Add words"]);
    expect(within(nav).getByRole("link", { name: "Study" })).toHaveAttribute("href", "/study");
    expect(within(nav).getByRole("link", { name: "My deck" })).toHaveAttribute("href", "/deck");
    expect(within(nav).getByRole("link", { name: "Add words" })).toHaveAttribute("href", "/add-words");
    // Studying also starts from the dashboard.
    expect((await screen.findAllByRole("link", { name: /^Start studying/ }))[0]!).toHaveAttribute("href", "/study");
  });

  it("marks Study as the current tab while studying, and nothing else", async () => {
    mock.loggedIn = true;
    renderApp("/study");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Study" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("shows English and Dutch flags cut along a slash between the site name and the tabs, as decoration", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const brand = screen.getByRole("link", { name: "Flashcards" });
    const flags = brand.parentElement!.querySelector("svg.flag-split")!;
    // One picture: the first flag clipped to the left of the slash, the second to the right.
    const clips = [...flags.querySelectorAll("clipPath")].map((c) => c.id);
    expect(clips.some((id) => id.endsWith("-left"))).toBe(true);
    expect(clips.some((id) => id.endsWith("-right"))).toBe(true);
    expect(flags.querySelectorAll("line")).toHaveLength(1);
    expect(brand.compareDocumentPosition(flags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flags.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Hidden from screen readers, so they do not add to the flags on a card.
    expect(flags).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img", { name: "English" })).not.toBeInTheDocument();
  });

  it("takes you back to the dashboard when you press Settings while already looking at it", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/");

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("goes back to the dashboard from any tab of the settings, not just the first", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Settings" }));
    for (const tab of ["Study", "Appearance", "Security", "Your data"]) {
      await user.click(await screen.findByRole("tab", { name: tab }));
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/");
    }
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("goes back to the dashboard when the settings were opened on a tab by address", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    expect(await screen.findByRole("link", { name: "Settings" })).toHaveAttribute("href", "/");
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("has Settings and Log out as icons in the top corner, not in the main navigation", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const settings = await screen.findByRole("link", { name: "Settings" });
    const logout = screen.getByRole("button", { name: "Log out" });

    // Icons only: an image, no visible words.
    for (const control of [settings, logout]) {
      expect(control.querySelector("svg")).not.toBeNull();
      expect(control.textContent).toBe("");
    }
    expect(settings).toHaveAttribute("href", "/settings");
    // The tooltip text is drawn by CSS from data-tooltip, so it shows on hover and keyboard focus
    // without the browser's delayed title tooltip (which would show a second one).
    expect(settings).toHaveAttribute("data-tooltip", "Settings");
    expect(logout).toHaveAttribute("data-tooltip", "Log out");
    expect(settings).not.toHaveAttribute("title");
    expect(logout).not.toHaveAttribute("title");

    // They sit together with the account details, after the page links.
    const account = settings.parentElement!;
    expect(account).toContainElement(logout);
    expect(account).toHaveTextContent("ann@example.com");
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("greets you by name in the top right when there is one, and shows the email when there is not", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /auth/me"] = () => json(200, { user: { id: "u1", email: "ann@example.com", name: "Anna" } });
    const view = renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });
    const account = () => document.querySelector(".account .email")!;
    expect(account()).toHaveTextContent("Hi, Anna");
    expect(account()).not.toHaveTextContent("ann@example.com");
    view.unmount();

    mock.handlers["GET /auth/me"] = () => json(200, { user: { id: "u1", email: "ann@example.com", name: null } });
    renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(account()).toHaveTextContent("ann@example.com");
  });

  it("asks for an optional name when signing up, but not when logging in", async () => {
    const view = renderApp("/register");
    expect(await screen.findByLabelText(/Name/)).toBeInTheDocument();
    const optional = screen.getByText("(optional)");
    // On the same line as "Name": inside the same element as the word, not a row of its own.
    expect(optional.parentElement).toHaveTextContent("Name (optional)");
    expect(optional.parentElement?.parentElement).toBe(screen.getByLabelText(/Name/).parentElement);
    expect(optional.parentElement?.children).toHaveLength(1);
    view.unmount();

    renderApp("/login");
    await screen.findByLabelText("Email");
    expect(screen.queryByLabelText(/Name/)).not.toBeInTheDocument();
  });

  it("sends the name when one is entered, and leaves it out when not", async () => {
    const bodies: Record<string, unknown>[] = [];
    mock.handlers["POST /auth/register"] = (b) => {
      bodies.push(b as Record<string, unknown>);
      return json(201, { user: { id: "u1", email: "ann@example.com", name: null } });
    };
    const user = userEvent.setup();
    const view = renderApp("/register");
    await user.type(await screen.findByLabelText(/Name/), "  Anna ");
    await user.type(screen.getByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(bodies[0]).toMatchObject({ name: "Anna", email: "ann@example.com" });
    view.unmount();

    mock.loggedIn = false;
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "bob@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(bodies[1]).not.toHaveProperty("name");
  });

  it("refuses a name that is too long when signing up", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText(/Name/), "x".repeat(61));
    await user.type(screen.getByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByText("Use 60 characters or fewer.")).toBeInTheDocument();
    expect(mock.calls).not.toContain("POST /auth/register");
  });

  it("forgets remembered filters when someone signs in, and when they sign out", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    sessionStorage.setItem("remembered:en-nl:packs:category", JSON.stringify("topic"));
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(sessionStorage.getItem("remembered:en-nl:packs:category")).toBeNull();

    sessionStorage.setItem("remembered:en-nl:deck:stage", JSON.stringify("review"));
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Log in" });
    expect(sessionStorage.getItem("remembered:en-nl:deck:stage")).toBeNull();
  });

  it("shows an error for wrong credentials and stays on the form", async () => {
    mock.handlers["POST /auth/login"] = () => json(401, { error: "Invalid email or password" });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("validates on the client before calling the API", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(mock.calls).not.toContain("POST /auth/register");
  });

  it("registers a new account", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("sends the browser's time zone when registering, but not when logging in", async () => {
    const zone = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "America/Chicago" } as Intl.ResolvedDateTimeFormatOptions);
    let registered: unknown;
    let loggedIn: unknown;
    mock.handlers["POST /auth/register"] = (b) => {
      registered = b;
      return json(201, { user: { id: "u1", email: "ann@example.com" } });
    };
    mock.handlers["POST /auth/login"] = (b) => {
      loggedIn = b;
      return json(200, { user: { id: "u1", email: "ann@example.com" } });
    };
    try {
      const user = userEvent.setup();
      const view = renderApp("/register");
      await user.type(await screen.findByLabelText("Email"), "ann@example.com");
      await user.type(screen.getByLabelText("Password"), "correct horse battery");
      await user.click(screen.getByRole("button", { name: "Sign up" }));
      await screen.findByRole("heading", { name: "Dashboard" });
      expect(registered).toMatchObject({ email: "ann@example.com", timezone: "America/Chicago" });
      view.unmount();

      mock.loggedIn = false;
      renderApp("/login");
      await user.type(await screen.findByLabelText("Email"), "ann@example.com");
      await user.type(screen.getByLabelText("Password"), "correct horse battery");
      await user.click(screen.getByRole("button", { name: "Log in" }));
      await screen.findByRole("heading", { name: "Dashboard" });
      expect(loggedIn).not.toHaveProperty("timezone");
    } finally {
      zone.mockRestore();
    }
  });

  it("explains when the email is already registered", async () => {
    mock.handlers["POST /auth/register"] = () => json(409, { error: "Email already registered" });
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
  });

  it("explains when sign-ups are invite-only", async () => {
    mock.handlers["POST /auth/register"] = () => json(403, { error: "Registration is closed" });
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "eve@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invite-only");
  });

  it("sends signed-in users away from the login page", async () => {
    mock.loggedIn = true;
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("logs out back to the login page", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("Start studying in the page header", () => {
  beforeEach(() => {
    mock.handlers["GET /deck"] = () =>
      json(200, { summary: { total: 3, new: 3, learning: 0, relearning: 0, review: 0, dueNow: 0 }, hasMore: false, cards: [] });
  });
  const nothingReady = () =>
    (mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 }, newLimitReached: false, tomorrow: 0 }));
  const headerButton = async (heading: string) => {
    const head = (await screen.findByRole("heading", { name: heading, level: 1 })).closest(".page-head")!;
    return within(head as HTMLElement).queryByRole("link", { name: /^Start studying/ });
  };

  it.each([
    ["/", "Dashboard"],
    ["/deck", "My deck"],
    ["/add-words", "Add words"],
  ])("is above the navigation buttons at the top right of %s", async (route, heading) => {
    mock.loggedIn = true;
    renderApp(route);
    const head = (await screen.findByRole("heading", { name: heading, level: 1 })).closest(".page-head") as HTMLElement;
    const start = await within(head).findByRole("link", { name: /^Start studying/ });
    expect(start).toHaveAttribute("href", "/study");
    expect(start).toHaveClass("button", "primary");
    // In the right-hand column of the header, before the buttons that take you to other pages.
    const right = head.querySelector(".page-head-right")!;
    expect(right).toContainElement(start);
    const nav = right.querySelector(".page-head-actions")!;
    expect(start.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav).not.toContainElement(start);
    expect(head.lastElementChild).toBe(right);
  });

  it("takes you straight to a study session", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/deck");
    const head = (await screen.findByRole("heading", { name: "My deck", level: 1 })).closest(".page-head") as HTMLElement;
    await user.click(await within(head).findByRole("link", { name: /^Start studying/ }));
    expect(await screen.findByRole("heading", { name: "Study" })).toBeInTheDocument();
  });

  it("has a tag showing how many cards are ready, like the counts on the filters of My deck", async () => {
    mock.loggedIn = true;
    // 2 learning and 3 to review are due now, and 5 new cards can be started: 10 in all.
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 2, review: 3, new: 5 }, newLimitReached: false, tomorrow: 0 });
    renderApp("/deck");
    const head = (await screen.findByRole("heading", { name: "My deck", level: 1 })).closest(".page-head") as HTMLElement;
    const start = await within(head).findByRole("link", { name: /^Start studying/ });
    const tag = start.querySelector(".count")!;
    expect(tag).toHaveTextContent("10");
    // Said once to a screen reader, as part of the button's name.
    expect(start).toHaveAccessibleName("Start studying, 10 ready");
    // The same tag as the filters on the deck page.
    expect(within(head).queryByText("10", { selector: ".toggle .count" })).not.toBeInTheDocument();
  });

  it.each([
    ["/", "Dashboard"],
    ["/deck", "My deck"],
    ["/add-words", "Add words"],
  ])("is disabled on %s, saying so, when there is nothing to study", async (route, heading) => {
    mock.loggedIn = true;
    nothingReady();
    renderApp(route);
    const head = (await screen.findByRole("heading", { name: heading, level: 1 })).closest(".page-head") as HTMLElement;
    const none = await within(head).findByRole("button", { name: "No cards ready to study" });
    expect(none).toBeDisabled();
    expect(none).toHaveClass("primary");
    // Not a way to study, and in the same place as the button it stands in for.
    expect(await headerButton(heading)).toBeNull();
    expect(head.querySelector(".page-head-start")).toContainElement(none);
  });

  it("goes back to a link when cards become ready", async () => {
    mock.loggedIn = true;
    let ready = false;
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: ready ? 3 : 0 }, newLimitReached: false, tomorrow: 0 });
    const user = userEvent.setup();
    renderApp("/deck");
    const head = (await screen.findByRole("heading", { name: "My deck", level: 1 })).closest(".page-head") as HTMLElement;
    expect(await within(head).findByRole("button", { name: "No cards ready to study" })).toBeDisabled();
    ready = true;
    await user.click(within(head).getByRole("link", { name: "Go to dashboard" }));
    await user.click((await screen.findAllByRole("link", { name: "View deck" }))[0]!); // the page header's
    expect(await screen.findByRole("link", { name: /^Start studying/ })).toBeInTheDocument();
  });

  it("does not ask the server again for what the dashboard just fetched", async () => {
    mock.loggedIn = true;
    renderApp("/");
    await screen.findByRole("region", { name: "Ready to study" });
    await screen.findAllByRole("link", { name: /^Start studying/ });
    expect(mock.calls.filter((c) => c === "GET /study/counts")).toHaveLength(1);
  });
});

describe("dashboard", () => {
  describe("the daily new card limit", () => {
    // `due` cards are ready to study besides the new ones, which the limit has shut out.
    const counts = (newLimitReached: boolean, due = 0) => ({
      now: "x",
      counts: { learning: 0, review: due, new: 0 },
      newLimitReached,
      tomorrow: 0,
    });

    it("says that no new cards are available today, with a link to the settings, above the deck", async () => {
      mock.loggedIn = true;
      mock.handlers["GET /study/counts"] = () => json(200, counts(true));
      renderApp("/");
      const note = await screen.findByText(/No new cards are available to study today because you have reached your daily new card limit/);
      const link = within(note).getByRole("link", { name: "Settings" });
      expect(link).toHaveAttribute("href", "/settings?tab=study");
      // Just above the "Your deck" section, which comes straight after it.
      const heading = await screen.findByRole("heading", { name: "Your deck" });
      expect(note.nextElementSibling).toContainElement(heading);
    });

    it("says nothing about it while cards are due, as there is something to study", async () => {
      mock.loggedIn = true;
      mock.handlers["GET /study/counts"] = () => json(200, counts(true, 3));
      renderApp("/");
      await screen.findByRole("region", { name: "Progress" });
      expect(await screen.findByText("3 cards ready to study")).toBeInTheDocument();
      expect(screen.queryByText(/daily new card limit/)).not.toBeInTheDocument();
    });

    it("says nothing about it otherwise", async () => {
      mock.loggedIn = true;
      mock.handlers["GET /study/counts"] = () => json(200, counts(false, 3));
      renderApp("/");
      await screen.findByRole("region", { name: "Progress" });
      expect(screen.queryByText(/daily new card limit/)).not.toBeInTheDocument();
    });

    it("goes to the study tab of the settings when the link is followed", async () => {
      mock.loggedIn = true;
      mock.handlers["GET /study/counts"] = () => json(200, counts(true));
      const user = userEvent.setup();
      renderApp("/");
      const note = await screen.findByText(/daily new card limit/);
      await user.click(within(note).getByRole("link", { name: "Settings" }));
      expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(await screen.findByRole("tab", { name: "Study" })).toHaveAttribute("aria-selected", "true");
    });
  });

  it("uses the same header layout as the deck and Add words pages, so the buttons line up", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck"] = () =>
      json(200, {
        summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 },
        hasMore: false,
        cards: [],
      });
    const headerOf = async (route: string, heading: string) => {
      const view = renderApp(route);
      const h1 = await screen.findByRole("heading", { name: heading, level: 1 });
      const head = h1.closest(".page-head");
      const actions = head?.querySelector(".page-head-actions");
      const markup = { head: head?.className, actions: actions?.className };
      view.unmount();
      return markup;
    };
    const expected = { head: "page-head", actions: "page-head-actions" };
    expect(await headerOf("/", "Dashboard")).toEqual(expected);
    expect(await headerOf("/deck", "My deck")).toEqual(expected);
    expect(await headerOf("/add-words", "Add words")).toEqual(expected);
  });

  it("puts View deck and Add more words at the top right, level with the heading", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const view = (await screen.findAllByRole("link", { name: "View deck" }))[0]!; // the first is the header's
    const add = screen.getByRole("link", { name: "Add more words" });
    expect(view.parentElement).toBe(add.parentElement);
    expect(view.parentElement).toHaveClass("page-head-actions");
    expect(view.nextElementSibling).toBe(add);
    const head = view.closest(".page-head")!;
    expect(head).toBeTruthy();
    expect(head.firstElementChild).toBe(screen.getByRole("heading", { name: "Dashboard" }));
    // Repeated only across from the "Your deck" heading, where a phone shows it in place of these.
    const all = screen.getAllByRole("link", { name: "View deck" });
    expect(all).toHaveLength(2);
    expect(all[1]!.closest(".section-head")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Add more words" })).toHaveLength(1);
  });

  it("keeps View deck and Add more words when the deck is empty, next to Browse words", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 } });
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Browse words" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View deck" })).toHaveAttribute("href", "/deck");
    expect(screen.getByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/add-words");
  });

  it("shows how the deck splits into review, learning, and new", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const progress = await screen.findByRole("region", { name: "Progress" });
    expect(progress).toHaveTextContent("4Review");
    expect(progress).toHaveTextContent("3Learning"); // 2 + 1
    expect(progress).toHaveTextContent("5New");
    expect(screen.getByRole("img", { name: /4 review, 3 learning, 5 new, of 12 cards/ })).toBeInTheDocument();
  });

  it("summarizes what is ready and offers to add more words", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const hero = await screen.findByRole("region", { name: "Ready to study" });
    expect(hero).toHaveTextContent("11 cards ready to study"); // 4 due + 7 new
    expect(hero).toHaveTextContent("4 due for review · 7 new");
    // Starting is done from the button at the top of the page, not from the hero.
    expect(within(hero).queryByRole("link", { name: /^Start studying/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Start studying/ })).toHaveAttribute("href", "/study");
    // "Add more words" lives next to "View deck" at the top of the page, not in the hero.
    expect(within(hero).queryByRole("link", { name: "Add more words" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View deck" })[0]).toHaveAttribute("href", "/deck");
    expect(screen.getByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/add-words");
    expect(screen.getByRole("img", { name: /3 learning/ })).toBeInTheDocument();
  });

  it("says you are caught up when nothing is due", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByText("No cards to study right now")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Start studying/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/add-words");
  });

  describe("with several decks", () => {
    const dir = (from: string, to: string) => ({ fromLanguage: from, toLanguage: to, total: 8 });
    const stats = (directions: unknown[], extra = {}) => ({
      now: "2026-01-15T10:00:00.000Z",
      nextDueAt: null,
      directions,
      ...extra,
    });

    beforeEach(() => {
      localStorage.removeItem("dashboardDirection:en-nl");
      mock.loggedIn = true;
      mock.handlers["GET /stats"] = () =>
        json(200, stats([dir("en", "nl"), dir("nl", "en")]));
    });

    it("shows the whole deck with no filter by direction, however many directions it has", async () => {
      renderApp("/");
      const hero = await screen.findByRole("region", { name: "Ready to study" });
      expect(hero).toHaveTextContent("11 cards ready to study");
      await screen.findByRole("heading", { name: "Your deck" });
      expect(screen.queryByRole("group", { name: "Deck view" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "NL → EN" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Both" })).not.toBeInTheDocument();
      // Only the whole deck is asked about: no request is for one direction.
      expect(mock.calls.filter((c) => c.startsWith("GET /deck") && c.includes("fromLanguage"))).toEqual([]);
    });

    it("says how many cards the deck has, beside the Your deck heading", async () => {
      renderApp("/");
      const heading = await screen.findByRole("heading", { name: "Your deck" });
      expect(heading.nextElementSibling).toHaveTextContent(/^\d+ cards?$/);
    });

    it("has a View deck button across from the Your deck heading, which a phone's styles show", async () => {
      renderApp("/");
      const heading = await screen.findByRole("heading", { name: "Your deck" });
      const head = heading.closest(".section-head") as HTMLElement;
      expect(head).toBeTruthy();
      const button = within(head).getByRole("link", { name: "View deck" });
      expect(button).toHaveAttribute("href", "/deck");
      expect(head.firstElementChild).toContainElement(heading);
      expect(head.lastElementChild).toBe(button);
    });

    it("has one Start studying button, however many directions the deck has", async () => {
      renderApp("/");
      const hero = await screen.findByRole("region", { name: "Ready to study" });
      await screen.findByRole("heading", { name: "Your deck" });
      // The hero has no buttons of its own; the one at the top of the page is the only way to start.
      expect(within(hero).queryAllByRole("link")).toHaveLength(0);
      expect(screen.getAllByRole("link", { name: /^Start studying/ })).toHaveLength(1);
      expect(screen.getByRole("link", { name: /^Start studying/ })).toHaveAttribute("href", "/study");
      expect(screen.queryByRole("link", { name: /^Study / })).not.toBeInTheDocument();
    });

    describe("when nothing is ready", () => {
      const idle = (tomorrow: number, nextDueAt: string | null = null) => {
        mock.handlers["GET /study/counts"] = () =>
          json(200, {
            now: "2026-01-15T10:00:00.000Z",
            counts: { learning: 0, review: 0, new: 0 },
            tomorrow,
          });
        mock.handlers["GET /stats"] = () => json(200, stats([dir("en", "nl")], { nextDueAt }));
      };

      it("says how many cards will be ready tomorrow", async () => {
        idle(28);
        renderApp("/");
        expect(await screen.findByText("28 cards will be ready tomorrow.")).toBeInTheDocument();
        expect(screen.getByText("No cards to study right now")).toBeInTheDocument();
        expect(screen.queryByText("Come back later or add more words.")).not.toBeInTheDocument();
      });

      it("uses the singular, and shows it alongside when the next card is due", async () => {
        idle(1, "2026-01-15T13:00:00.000Z");
        renderApp("/");
        expect(await screen.findByText("1 card will be ready tomorrow.")).toBeInTheDocument();
        expect(screen.getByText("Next card in 3 hours.")).toBeInTheDocument();
      });

      it("says nothing about tomorrow when nothing will be ready", async () => {
        idle(0);
        renderApp("/");
        expect(await screen.findByText("Come back later or add more words.")).toBeInTheDocument();
        expect(screen.queryByText(/ready tomorrow/)).not.toBeInTheDocument();
      });
    });

    it("says when the next card is due if nothing is ready", async () => {
      mock.handlers["GET /study/counts"] = () =>
        json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 }, cards: [] });
      mock.handlers["GET /stats"] = () =>
        json(200, stats([dir("en", "nl")], { nextDueAt: "2026-01-15T13:00:00.000Z" }));
      renderApp("/");
      expect(await screen.findByText("Next card in 3 hours.")).toBeInTheDocument();
    });

    it("still works when the extra stats cannot be loaded", async () => {
      mock.handlers["GET /stats"] = () => json(500, { error: "boom" });
      renderApp("/");
      expect((await screen.findAllByRole("link", { name: /^Start studying/ }))[0]!).toBeInTheDocument();
    });
  });

  it("links to the page explaining how scheduling works", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "FSRS" }));
    expect(await screen.findByRole("heading", { name: "How scheduling works" })).toBeInTheDocument();
    expect(screen.getByText("Again")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Dashboard/ })[0]).toHaveAttribute("href", "/");
  });

  it("shows an empty state for a new user", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, {
        summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 },
      });
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByText(/Your deck is empty/)).toBeInTheDocument();
  });

  describe("for someone with an empty deck", () => {
    beforeEach(() => {
      mock.loggedIn = true;
      mock.handlers["GET /deck?limit=1"] = () =>
        json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 } });
    });
    const pack = (slug: string, id: string, name: string) => ({
      id, slug, name, description: null, category: "common", conceptCount: 10,
    });

    it("points to the starter words first, with Browse words beside it", async () => {
      mock.handlers["GET /packs"] = () =>
        json(200, { packs: [pack("animals", "p-animals", "Animals"), pack("starter", "p-starter", "Starter words")] });
      renderApp("/");
      const starter = await screen.findByRole("link", { name: "Start with the starter words" });
      expect(starter).toHaveAttribute("href", "/add-words/p-starter");
      expect(starter).toHaveClass("primary");
      expect(screen.getByRole("link", { name: "Browse words" })).toHaveClass("secondary");
    });

    it("keeps Browse words as the main button when there is no starter pack", async () => {
      mock.handlers["GET /packs"] = () => json(200, { packs: [pack("animals", "p-animals", "Animals")] });
      renderApp("/");
      expect(await screen.findByRole("link", { name: "Browse words" })).toHaveClass("primary");
      expect(screen.queryByRole("link", { name: "Start with the starter words" })).not.toBeInTheDocument();
    });

    it("still works when the packs cannot be loaded", async () => {
      mock.handlers["GET /packs"] = () => json(500, { error: "boom" });
      renderApp("/");
      expect(await screen.findByRole("link", { name: "Browse words" })).toBeInTheDocument();
    });

    it("explains adding words and the answer buttons", async () => {
      renderApp("/");
      const guide = within(await screen.findByRole("region", { name: "Getting started" }));
      const steps = guide.getAllByRole("listitem").map((li) => li.textContent);
      expect(steps).toHaveLength(2);
      expect(steps[0]).toMatch(/Add some words/);
      expect(steps[1]).toMatch(/Again,\s+Hard, Good, or Easy/);
      expect(guide.queryByText(/direction/i)).not.toBeInTheDocument();
      // The link is on a line of its own, after the steps.
      const link = guide.getByRole("link", { name: "Learn more about scheduling" });
      expect(link).toHaveAttribute("href", "/how-it-works");
      expect(link.closest("li")).toBeNull();
      expect(link.parentElement!.textContent).toBe("Learn more about scheduling");
      expect(link.parentElement).toHaveClass("getting-started-more"); // centered
    });
  });

  it("does not show the getting started guide once there are cards", async () => {
    mock.loggedIn = true;
    renderApp("/");
    await screen.findByRole("heading", { name: "Your deck" });
    expect(screen.queryByRole("region", { name: "Getting started" })).not.toBeInTheDocument();
  });

  it("shows an error when the data cannot be loaded", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () => json(500, { error: "boom" });
    renderApp("/");
    expect(await screen.findByText(/Could not load your dashboard/)).toBeInTheDocument();
  });
});
