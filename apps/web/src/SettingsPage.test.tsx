import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

let saved: {
  email: string;
  name: string | null;
  timezone: string;
  dailyNewCardLimit: number;
  showSentences: boolean;
  showForms: boolean;
};
let patches: unknown[];
let posts: Record<string, unknown[]>;

// Pretend the browser is set to this time zone.
const browserZone = (timeZone: string) =>
  vi
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);

const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(await screen.findByRole("tab", { name }));

const topBar = () => document.querySelector(".account .email")!;

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  saved = {
    email: "ann@example.com",
    name: null,
    timezone: "Europe/Amsterdam",
    dailyNewCardLimit: 20,
    showSentences: true,
    showForms: true,
  };
  patches = [];
  posts = {};
  browserZone("Europe/Amsterdam");
  mock.handlers["GET /settings"] = () => json(200, saved);
  mock.handlers["PATCH /settings"] = (body) => {
    patches.push(body);
    saved = { ...saved, ...(body as object) };
    return json(200, saved);
  };
  mock.handlers["GET /auth/me"] = () =>
    json(200, { user: mock.loggedIn ? { id: "u1", email: saved.email, name: saved.name } : null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("the settings page", () => {
  it("is reachable from the gear icon and starts on Profile", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "Settings sections" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Profile", "Study", "Appearance", "Security", "Your data"]);
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("What should we call you?")).toBeInTheDocument();
  });

  it("shows one section at a time, so each fits on the screen", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    await screen.findByLabelText("What should we call you?");
    expect(screen.queryByLabelText("New cards per day")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm new password")).not.toBeInTheDocument();

    await openTab(user, "Study");
    expect(screen.getByLabelText("New cards per day")).toBeInTheDocument();
    expect(screen.queryByLabelText("What should we call you?")).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-study");
  });

  it("keeps the open section in the address, and opens the one a link names", async () => {
    renderApp("/settings?tab=security");
    expect(await screen.findByRole("tab", { name: "Security" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("falls back to Profile for an unknown section", async () => {
    renderApp("/settings?tab=nonsense");
    expect(await screen.findByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves between the sections with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    const profile = await screen.findByRole("tab", { name: "Profile" });
    profile.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Study" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Study" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Your data" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}"); // wraps around
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Your data" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("only the selected tab is in the tab order", async () => {
    renderApp("/settings?tab=study");
    expect(await screen.findByRole("tab", { name: "Study" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("tabindex", "-1");
  });

  it("shows an error when the settings cannot be loaded", async () => {
    mock.handlers["GET /settings"] = () => json(500, { error: "boom" });
    renderApp("/settings");
    expect(await screen.findByText(/Could not load your settings/)).toBeInTheDocument();
  });
});

describe("Profile", () => {
  it("has no Save button: the name saves when you leave the box after changing it", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("What should we call you?");
    expect(topBar()).toHaveTextContent("ann@example.com");
    expect(screen.queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();

    await user.type(input, "  Anna  ");
    expect(patches).toEqual([]); // not while still typing
    await user.tab();
    await screen.findByText("Saved");
    expect(patches).toEqual([{ name: "Anna" }]);
    expect(input).toHaveValue("Anna"); // the stray spaces are gone
    expect(topBar()).toHaveTextContent("Hi, Anna");
  });

  it("shows Saved right beside the box, and it goes away again by itself", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("What should we call you?");
    await user.type(input, "Anna");
    await user.tab();

    await waitFor(() => expect(input.nextElementSibling).toHaveTextContent("✓ Saved"));
    expect(input.nextElementSibling?.getAttribute("role")).toBe("status");
    await waitFor(() => expect(input.nextElementSibling?.textContent).toBe(""), { timeout: 3000 });
  });

  it("does not save when the name has not changed", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("What should we call you?");
    await user.click(input);
    await user.tab(); // left without typing
    await user.click(input);
    await user.type(input, "Anna");
    await user.clear(input); // and back to what is saved
    await user.tab();
    await new Promise((r) => setTimeout(r, 300));
    expect(patches).toEqual([]);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("saves on Enter, and only once if the box is left afterwards", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    await user.type(await screen.findByLabelText("What should we call you?"), "Anna{Enter}");
    await screen.findByText("Saved");
    await user.tab();
    await new Promise((r) => setTimeout(r, 300));
    expect(patches).toEqual([{ name: "Anna" }]);
  });

  it("clears the name, so the top bar goes back to the email", async () => {
    saved.name = "Anna";
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("What should we call you?");
    expect(input).toHaveValue("Anna");
    expect(topBar()).toHaveTextContent("Hi, Anna");
    await user.clear(input);
    await user.tab();
    await screen.findByText("Saved");
    expect(patches).toEqual([{ name: "" }]);
    expect(topBar()).toHaveTextContent("ann@example.com");
  });

  it("refuses a name that is too long, without calling the server", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    await user.type(await screen.findByLabelText("What should we call you?"), "x".repeat(61));
    await user.tab();
    expect(await screen.findByText("Use 60 characters or fewer.")).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it("says beside the box when saving fails, and keeps what was typed", async () => {
    mock.handlers["PATCH /settings"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("What should we call you?");
    await user.type(input, "Anna");
    await user.tab();
    await waitFor(() => expect(input.nextElementSibling).toHaveTextContent("Could not save. Try again."));
    expect(input).toHaveValue("Anna");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  describe("changing the email address", () => {
    beforeEach(() => {
      posts["/account/email"] = [];
      mock.handlers["POST /account/email"] = (body) => {
        posts["/account/email"]!.push(body);
        const { email } = body as { email: string };
        saved = { ...saved, email };
        return json(200, { user: { id: "u1", email, name: saved.name } });
      };
    });

    const fill = async (user: ReturnType<typeof userEvent.setup>, email: string, password: string) => {
      await user.type(await screen.findByLabelText("New email address"), email);
      await user.type(screen.getByLabelText("Current password"), password);
    };

    it("shows the current address, and needs the new one and the password", async () => {
      const user = userEvent.setup();
      renderApp("/settings");
      expect(await screen.findByText("ann@example.com", { selector: "strong" })).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Change email" });
      expect(button).toBeDisabled();
      await user.type(screen.getByLabelText("New email address"), "new@example.com");
      expect(button).toBeDisabled();
      await user.type(screen.getByLabelText("Current password"), "secret");
      expect(button).toBeEnabled();
    });

    it("changes it, shows a checkmark, clears the fields, and the top bar and page follow", async () => {
      const user = userEvent.setup();
      renderApp("/settings");
      await fill(user, "new@example.com", "my password");
      await user.click(screen.getByRole("button", { name: "Change email" }));

      await screen.findByRole("button", { name: "Email changed" });
      expect(posts["/account/email"]).toEqual([{ email: "new@example.com", password: "my password" }]);
      expect(screen.getByLabelText("New email address")).toHaveValue("");
      expect(screen.getByLabelText("Current password")).toHaveValue("");
      expect(screen.getByText("new@example.com", { selector: "strong" })).toBeInTheDocument();
      expect(topBar()).toHaveTextContent("new@example.com");
    });

    it("refuses an invalid address without calling the server", async () => {
      const user = userEvent.setup();
      renderApp("/settings");
      await fill(user, "not-an-email", "pw");
      await user.click(screen.getByRole("button", { name: "Change email" }));
      expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
      expect(posts["/account/email"]).toEqual([]);
    });

    it("says when the password is wrong", async () => {
      mock.handlers["POST /account/email"] = () => json(403, { error: "Incorrect password" });
      const user = userEvent.setup();
      renderApp("/settings");
      await fill(user, "new@example.com", "wrong");
      await user.click(screen.getByRole("button", { name: "Change email" }));
      expect(await screen.findByText("That password is not right.")).toBeInTheDocument();
      expect(topBar()).toHaveTextContent("ann@example.com");
    });

    it("says when the address is already registered, and when there were too many attempts", async () => {
      mock.handlers["POST /account/email"] = () => json(409, { error: "Email already registered" });
      const user = userEvent.setup();
      renderApp("/settings");
      await fill(user, "taken@example.com", "pw");
      await user.click(screen.getByRole("button", { name: "Change email" }));
      expect(await screen.findByText("That email address is already registered.")).toBeInTheDocument();

      mock.handlers["POST /account/email"] = () => json(429, { error: "slow down" });
      await user.click(screen.getByRole("button", { name: "Change email" }));
      expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
    });
  });
});

describe("Study", () => {
  it("has no Save button: changes save themselves", async () => {
    renderApp("/settings?tab=study");
    expect(await screen.findByLabelText("New cards per day")).toHaveValue(20);
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Amsterdam");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("saves the time zone as soon as it changes, and shows Saved right beside it for a moment", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const select = await screen.findByLabelText("Time zone");
    await user.selectOptions(select, "America/New_York");

    await waitFor(() => expect(select.nextElementSibling).toHaveTextContent("✓ Saved"));
    expect(patches).toEqual([{ timezone: "America/New_York" }]);
    // The daily limit's own spot stays empty.
    expect(screen.getByLabelText("New cards per day").nextElementSibling?.textContent).toBe("");
    // ... and the message goes away by itself.
    await waitFor(() => expect(select.nextElementSibling?.textContent).toBe(""), { timeout: 3000 });
  });

  it("saves the daily limit shortly after typing stops, as one request", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "35");

    // Not on every keystroke: nothing has been sent yet.
    expect(patches).toEqual([]);
    expect(await screen.findByText("Saved", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(patches).toEqual([{ dailyNewCardLimit: 35 }]);
    expect(screen.getByLabelText("New cards per day")).toHaveValue(35);
    // Right beside the number box, not elsewhere on the page.
    expect(input.nextElementSibling).toHaveTextContent("✓ Saved");
  });

  it("saves the daily limit at once when the box loses focus", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "40");
    expect(patches).toEqual([]);
    await user.tab();
    await waitFor(() => expect(patches).toEqual([{ dailyNewCardLimit: 40 }]));
  });

  it("still saves a limit that was typed just before leaving the tab", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "50");
    await user.click(screen.getByRole("tab", { name: "Profile" })); // leaves within the pause
    await waitFor(() => expect(patches).toEqual([{ dailyNewCardLimit: 50 }]));
  });

  it("does not save when the value is what is already saved", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "20");
    await user.tab();
    await new Promise((r) => setTimeout(r, 800));
    expect(patches).toEqual([]);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("allows 0 to pause new words", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "0");
    await user.tab();
    await waitFor(() => expect(patches).toEqual([{ dailyNewCardLimit: 0 }]));
  });

  it("explains a limit that is not a whole number from 0 to 200, and does not save it", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    for (const bad of ["201", "-3", "2.5", ""]) {
      await user.clear(input);
      if (bad) await user.type(input, bad);
      await user.tab();
      expect(await screen.findByRole("alert")).toHaveTextContent("Enter a whole number from 0 to 200.");
      input.focus();
    }
    expect(patches).toEqual([]);
  });

  it("takes the error away and saves once the value is fixed", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "999");
    await user.tab();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "25");
    await user.tab();
    await waitFor(() => expect(patches).toEqual([{ dailyNewCardLimit: 25 }]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers the browser's time zone, and saves it when used", async () => {
    saved.timezone = "UTC";
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    expect(await screen.findByText(/Your browser is set to Europe\/Amsterdam/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use it" }));
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Amsterdam");
    expect(screen.queryByText(/Your browser is set to/)).not.toBeInTheDocument();
    await screen.findByText("Saved");
    expect(patches).toEqual([{ timezone: "Europe/Amsterdam" }]);
  });

  it("does not suggest the browser's time zone when it already matches", async () => {
    renderApp("/settings?tab=study");
    await screen.findByLabelText("Time zone");
    expect(screen.queryByText(/Your browser is set to/)).not.toBeInTheDocument();
  });

  it("keeps room for the browser time zone note, so the page does not shift when it comes and goes", async () => {
    saved.timezone = "UTC";
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    // With the note showing ...
    expect(await screen.findByText(/Your browser is set to/)).toBeInTheDocument();
    const slot = document.querySelector(".zone-hint")!;
    expect(slot).not.toBeNull();
    expect(slot.parentElement).toBe(screen.getByLabelText("Time zone").closest(".setting"));
    // ... and with it gone, the same element is still there to hold the space.
    await user.click(screen.getByRole("button", { name: "Use it" }));
    expect(screen.queryByText(/Your browser is set to/)).not.toBeInTheDocument();
    expect(document.querySelector(".zone-hint")).toBe(slot);
    expect(slot.textContent).toBe("");
  });

  it("says when saving fails, and keeps what was typed", async () => {
    mock.handlers["PATCH /settings"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/settings?tab=study");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "30");
    await user.tab();
    expect(await screen.findByText("Could not save. Try again.")).toBeInTheDocument();
    expect(input.nextElementSibling).toHaveTextContent("Could not save. Try again.");
    expect(screen.getByLabelText("New cards per day")).toHaveValue(30);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  describe("what the study cards show", () => {
    const sentencesBox = () => screen.findByRole("checkbox", { name: "Show example sentences" });
    const formsBox = () => screen.findByRole("checkbox", { name: /Show word forms/ });
    const statusAfter = (box: HTMLElement) => box.closest("label")!.nextElementSibling!;

    it("starts from the account's settings", async () => {
      saved.showSentences = false;
      renderApp("/settings?tab=study");
      expect(await sentencesBox()).not.toBeChecked();
      expect(await formsBox()).toBeChecked();
    });

    it("saves to the account as soon as a box is ticked, with Saved beside that box", async () => {
      const user = userEvent.setup();
      renderApp("/settings?tab=study");
      const sentences = await sentencesBox();
      const forms = await formsBox();
      expect(sentences).toBeChecked();

      await user.click(sentences);
      expect(sentences).not.toBeChecked();
      await waitFor(() => expect(statusAfter(sentences)).toHaveTextContent("✓ Saved"));
      expect(patches).toEqual([{ showSentences: false }]);
      expect(statusAfter(forms).textContent).toBe(""); // the other box says nothing

      await user.click(forms);
      await waitFor(() => expect(patches).toEqual([{ showSentences: false }, { showForms: false }]));
      await waitFor(() => expect(statusAfter(forms)).toHaveTextContent("✓ Saved"));
    });

    it("turns them back on", async () => {
      saved.showSentences = false;
      const user = userEvent.setup();
      renderApp("/settings?tab=study");
      await user.click(await sentencesBox());
      await waitFor(() => expect(patches).toEqual([{ showSentences: true }]));
    });

    it("is kept with the account, not just on this device", async () => {
      const user = userEvent.setup();
      renderApp("/settings?tab=study");
      await user.click(await sentencesBox());
      await waitFor(() => expect(patches).toHaveLength(1));
      expect(localStorage.length).toBe(0);
    });

    it("puts the box back and says so when saving fails", async () => {
      mock.handlers["PATCH /settings"] = () => json(500, { error: "boom" });
      const user = userEvent.setup();
      renderApp("/settings?tab=study");
      const sentences = await sentencesBox();
      await user.click(sentences);
      await waitFor(() => expect(statusAfter(sentences)).toHaveTextContent("Could not save. Try again."));
      expect(sentences).toBeChecked();
    });
  });
});

describe("Appearance", () => {
  it("follows the browser by default", async () => {
    renderApp("/settings?tab=appearance");
    expect(await screen.findByRole("radio", { name: "Match my browser" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("switches to dark or light at once, and remembers it on this device", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=appearance");
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("goes back to following the browser", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=appearance");
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    await user.click(screen.getByRole("radio", { name: "Match my browser" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("says the theme only applies on this device", async () => {
    renderApp("/settings?tab=appearance");
    expect(await screen.findByText("Only applies on this device")).toBeInTheDocument();
  });

  it("starts from the theme remembered earlier", async () => {
    localStorage.setItem("theme", "dark");
    renderApp("/settings?tab=appearance");
    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
  });
});

describe("Security", () => {
  beforeEach(() => {
    posts["/account/password"] = [];
    mock.handlers["POST /account/password"] = (body) => {
      posts["/account/password"]!.push(body);
      return json(204);
    };
  });

  const fill = async (user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm = next) => {
    await user.type(await screen.findByLabelText("Current password"), current);
    await user.type(screen.getByLabelText("New password"), next);
    await user.type(screen.getByLabelText("Confirm new password"), confirm);
  };

  it("changes the password, clears the fields and says other devices were signed out", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=security");
    await fill(user, "old password", "a brand new password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await screen.findByRole("button", { name: "Password changed" });
    expect(posts["/account/password"]).toEqual([
      { currentPassword: "old password", newPassword: "a brand new password" },
    ]);
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
    expect(screen.getByText(/other devices have been signed out/)).toBeInTheDocument();
  });

  it("says that changing the password signs you out of other devices", async () => {
    renderApp("/settings?tab=security");
    expect(await screen.findByText("Changing your password signs you out of other devices")).toBeInTheDocument();
  });

  it("needs all three fields", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=security");
    const button = await screen.findByRole("button", { name: "Change password" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Current password"), "old");
    await user.type(screen.getByLabelText("New password"), "a brand new password");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new password");
    expect(button).toBeEnabled();
  });

  it("refuses a new password that is too short or does not match, without calling the server", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=security");
    await fill(user, "old password", "short");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 8 characters");

    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("New password"), "a brand new password");
    await user.type(screen.getByLabelText("Confirm new password"), "something different");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("The new passwords do not match.")).toBeInTheDocument();
    expect(posts["/account/password"]).toEqual([]);
  });

  it("says when the current password is wrong, and keeps what was typed", async () => {
    mock.handlers["POST /account/password"] = () => json(403, { error: "Incorrect password" });
    const user = userEvent.setup();
    renderApp("/settings?tab=security");
    await fill(user, "wrong", "a brand new password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("That current password is not right.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("a brand new password");
    expect(screen.queryByText(/have been signed out/)).not.toBeInTheDocument();
  });

  it("says when there have been too many attempts", async () => {
    mock.handlers["POST /account/password"] = () => json(429, { error: "slow down" });
    const user = userEvent.setup();
    renderApp("/settings?tab=security");
    await fill(user, "old", "a brand new password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
  });
});

describe("Your data", () => {
  it("offers the data as a download", async () => {
    renderApp("/settings?tab=data");
    const link = await screen.findByRole("link", { name: "Download my data" });
    expect(link).toHaveAttribute("href", "/api/account/export");
    expect(link).toHaveAttribute("download");
    expect(screen.getByText(/never includes your password/)).toBeInTheDocument();
  });

  describe("deleting the account", () => {
    it("asks for confirmation first, and can be cancelled", async () => {
      const user = userEvent.setup();
      renderApp("/settings?tab=data");
      expect(screen.queryByLabelText("Enter your password to confirm")).not.toBeInTheDocument();
      const open = await screen.findByRole("button", { name: "Delete my account…" });
      expect(open).toHaveClass("danger-outline"); // outlined in red: this is destructive
      await user.click(open);

      const confirm = screen.getByRole("button", { name: "Permanently delete my account" });
      expect(confirm).toBeDisabled(); // needs the password
      await user.type(screen.getByLabelText("Enter your password to confirm"), "pw");
      expect(confirm).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText("Enter your password to confirm")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete my account…" })).toBeInTheDocument();
    });

    it("deletes the account and signs out", async () => {
      let sent: unknown;
      mock.handlers["POST /account/delete"] = (body) => {
        sent = body;
        mock.loggedIn = false;
        return json(204);
      };
      const user = userEvent.setup();
      renderApp("/settings?tab=data");
      await user.click(await screen.findByRole("button", { name: "Delete my account…" }));
      await user.type(screen.getByLabelText("Enter your password to confirm"), "my password");
      await user.click(screen.getByRole("button", { name: "Permanently delete my account" }));

      expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
      expect(sent).toEqual({ password: "my password" });
    });

    it("says when the password is wrong and keeps the account", async () => {
      mock.handlers["POST /account/delete"] = () => json(403, { error: "Incorrect password" });
      const user = userEvent.setup();
      renderApp("/settings?tab=data");
      await user.click(await screen.findByRole("button", { name: "Delete my account…" }));
      await user.type(screen.getByLabelText("Enter your password to confirm"), "wrong");
      await user.click(screen.getByRole("button", { name: "Permanently delete my account" }));

      expect(await screen.findByText("That password is not right.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
  });
});
