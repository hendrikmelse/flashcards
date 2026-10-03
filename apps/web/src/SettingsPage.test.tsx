import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

let saved: { email: string; timezone: string; dailyNewCardLimit: number };
let patches: unknown[];

// Pretend the browser is set to this time zone.
const browserZone = (timeZone: string) =>
  vi
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  saved = { email: "ann@example.com", timezone: "Europe/Amsterdam", dailyNewCardLimit: 20 };
  patches = [];
  mock.handlers["GET /settings"] = () => json(200, saved);
  mock.handlers["PATCH /settings"] = (body) => {
    patches.push(body);
    saved = { ...saved, ...(body as object) };
    return json(200, saved);
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings page", () => {
  it("is reachable from the navigation and shows the current settings", async () => {
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("ann@example.com", { selector: ".lead" })).toBeInTheDocument();
    expect(screen.getByLabelText("New cards per day")).toHaveValue(20);
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Amsterdam");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet
  });

  it("saves a new daily limit", async () => {
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "35");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
    expect(patches).toEqual([{ dailyNewCardLimit: 35, timezone: "Europe/Amsterdam" }]);
    expect(screen.getByLabelText("New cards per day")).toHaveValue(35);
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("shows a spinner while saving, then a checkmark for a moment, then Save again", async () => {
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "40");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Spinner: held for at least 300 ms even though the mock answers at once.
    const saving = await screen.findByRole("button", { name: "Saving" });
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(saving.querySelector(".spinner")).not.toBeNull();
    const started = Date.now();

    // Checkmark.
    const saved = await screen.findByRole("button", { name: "Saved" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(saved.querySelector(".check")).toHaveTextContent("✓");
    expect(saved.querySelector(".spinner")).toBeNull();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();

    // Back to the normal label, which is disabled until something changes again.
    const normal = await screen.findByRole("button", { name: "Save" }, { timeout: 3000 });
    expect(normal.querySelector(".check")).toBeNull();
    expect(normal).toBeDisabled();
  });

  it("allows 0 to pause new words", async () => {
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saved" });
    expect(patches[0]).toMatchObject({ dailyNewCardLimit: 0 });
  });

  it("refuses a limit that is not a whole number from 0 to 200, without calling the server", async () => {
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("New cards per day");
    for (const bad of ["201", "-3", "2.5", ""]) {
      await user.clear(input);
      if (bad) await user.type(input, bad);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Enter a whole number from 0 to 200.");
    }
    expect(patches).toEqual([]);
  });

  it("changes the time zone", async () => {
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/settings");
    await user.selectOptions(await screen.findByLabelText("Time zone"), "America/New_York");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saved" });
    expect(patches).toEqual([{ dailyNewCardLimit: 20, timezone: "America/New_York" }]);
  });

  it("offers the browser's time zone when it differs from the saved one", async () => {
    saved.timezone = "UTC"; // what every account used to get
    browserZone("Europe/Amsterdam");
    const user = userEvent.setup();
    renderApp("/settings");

    expect(await screen.findByText(/Your browser is set to Europe\/Amsterdam/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use it" }));
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Amsterdam");
    expect(screen.queryByText(/Your browser is set to/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saved" });
    expect(patches[0]).toMatchObject({ timezone: "Europe/Amsterdam" });
  });

  it("does not suggest the browser's time zone when it already matches", async () => {
    browserZone("Europe/Amsterdam");
    renderApp("/settings");
    await screen.findByLabelText("Time zone");
    expect(screen.queryByText(/Your browser is set to/)).not.toBeInTheDocument();
  });

  it("says when saving fails, and keeps what was typed", async () => {
    browserZone("Europe/Amsterdam");
    mock.handlers["PATCH /settings"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/settings");
    const input = await screen.findByLabelText("New cards per day");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save your settings. Please try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("New cards per day")).toHaveValue(30);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument(); // no checkmark on failure
  });

  it("shows an error when the settings cannot be loaded", async () => {
    mock.handlers["GET /settings"] = () => json(500, { error: "boom" });
    renderApp("/settings");
    expect(await screen.findByText(/Could not load your settings/)).toBeInTheDocument();
  });
});
