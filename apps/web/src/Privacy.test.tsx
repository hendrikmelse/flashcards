import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER, installMockApi, json, mock, renderApp } from "./test/harness";

beforeEach(() => {
  installMockApi();
});
afterEach(() => vi.unstubAllGlobals());

describe("the dashboard's scheduling note and footer", () => {
  it("puts the link to how scheduling works right below the card saying what is ready to study", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const ready = await screen.findByRole("region", { name: "Ready to study" });
    const note = ready.nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent("This app uses FSRS for review scheduling");
    expect(within(note).getByRole("link", { name: "FSRS" })).toHaveAttribute("href", "/how-it-works");
  });

  it("ends with a quiet footer: the privacy policy, a copyright notice, and the maker's website", async () => {
    mock.loggedIn = true;
    renderApp("/");
    await screen.findByRole("region", { name: "Ready to study" });
    const footer = screen.getByRole("contentinfo");

    expect(within(footer).getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByText(`© ${new Date().getFullYear()} Hendrik Melse`)).toBeInTheDocument();
    const site = within(footer).getByRole("link", { name: /hendrikmelse\.com/ });
    expect(site).toHaveAttribute("href", "https://hendrikmelse.com");
    expect(site).toHaveAttribute("target", "_blank");
    expect(site).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(site).toHaveAccessibleName("hendrikmelse.com (opens in a new tab)");

    // A dot between the three, which a screen reader skips.
    const dots = footer.querySelectorAll(".sep");
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot).toHaveTextContent("·");
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
    expect(footer.textContent).toMatch(/Privacy policy\s*·\s*©/);
    expect(footer.textContent).toMatch(/Hendrik Melse\s*·\s*hendrikmelse\.com/);
  });

  it("is set apart from the page, after the main area rather than inside it", async () => {
    mock.loggedIn = true;
    renderApp("/");
    await screen.findByRole("region", { name: "Ready to study" });
    const footer = screen.getByRole("contentinfo");
    expect(document.querySelector("main")!.contains(footer)).toBe(false);
    expect(document.querySelector("main")!.nextElementSibling).toBe(footer);
  });

  it("keeps the footer for someone with an empty deck, without a second link to scheduling", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0 }, cards: [], hasMore: false });
    renderApp("/");
    expect(await screen.findByText("Your deck is empty")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.queryByText(/This app uses/)).not.toBeInTheDocument();
  });

  it("opens the privacy policy from the footer", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Privacy policy" }));
    expect(await screen.findByRole("heading", { name: "Privacy policy", level: 1 })).toBeInTheDocument();
  });
});

describe("the footer on every page", () => {
  const onPage = async (path: string, signedIn: boolean) => {
    mock.loggedIn = signedIn;
    renderApp(path);
    return screen.findByRole("contentinfo");
  };

  it("is on the pages of the app", async () => {
    for (const path of ["/", "/study", "/deck", "/add-words", "/reports", "/settings", "/how-it-works"]) {
      const footer = await onPage(path, true);
      expect(within(footer).getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
      cleanup();
    }
  });

  it("is on the pages for someone who is not signed in, too", async () => {
    for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/privacy", "/no-such-page"]) {
      const footer = await onPage(path, false);
      expect(within(footer).getByRole("link", { name: /hendrikmelse\.com/ })).toBeInTheDocument();
      cleanup();
    }
  });

  it("is on the admin pages", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /auth/me"] = () => json(200, { user: { ...USER, role: "admin" } });
    renderApp("/admin");
    expect(await screen.findByRole("contentinfo")).toBeInTheDocument();
  });

  it("is on the page once, not once for each part of it", async () => {
    const footer = await onPage("/privacy", false);
    expect(screen.getAllByRole("contentinfo")).toEqual([footer]);
  });
});

describe("the privacy policy page", () => {
  it("can be read without signing in, with a way back to the login page", async () => {
    mock.loggedIn = false;
    renderApp("/privacy");
    expect(await screen.findByRole("heading", { name: "Privacy policy", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "← Log in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("goes back to the dashboard for someone signed in", async () => {
    mock.loggedIn = true;
    renderApp("/privacy");
    expect(await screen.findByRole("link", { name: "← Dashboard" })).toHaveAttribute("href", "/");
  });

  it("says what is kept, who else handles it, and how to reach the owner", async () => {
    mock.loggedIn = false;
    renderApp("/privacy");
    await screen.findByRole("heading", { name: "Privacy policy", level: 1 });
    for (const heading of ["What I keep", "How I use it", "Who else handles it", "Cookies", "Your choices", "Children", "Contact"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
    expect(screen.getByText(/I don’t sell your data/)).toBeInTheDocument();
    for (const service of ["Resend", "Backblaze"]) expect(screen.getByText(service)).toBeInTheDocument();
    expect(screen.getByText(/Reports tab/)).toBeInTheDocument();
  });

  it("has a title for the browser tab", async () => {
    mock.loggedIn = false;
    renderApp("/privacy");
    await screen.findByRole("heading", { name: "Privacy policy", level: 1 });
    expect(document.title).toBe("Privacy policy · Flashcards");
  });
});
