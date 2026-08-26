import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";

function renderBell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

const openBell = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Notifications/ }));
  return user;
};

/** A fetch that stays pending, so the loading branch can be observed. */
const never = () => new Promise<never>(() => {});

const json = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationBell", () => {
  /* Regression: the component destructured only `data`, so an in-flight or
     failed request both rendered "You are all caught up." — telling the user
     there was nothing to see before anything had been fetched. */
  it("shows a loading state, not an empty state, while fetching", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderBell();
    await openBell();

    expect(
      await screen.findByRole("status", { name: "Loading notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("You are all caught up."),
    ).not.toBeInTheDocument();
  });

  it("reports a failure and offers a retry that refetches", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(json({ items: [], unread: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    renderBell();
    const user = await openBell();

    expect(
      await screen.findByText("Couldn't load notifications."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("You are all caught up."),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("You are all caught up."),
    ).toBeInTheDocument();
  });

  it("shows the empty state only when the response is genuinely empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ items: [], unread: 0 })),
    );
    renderBell();
    await openBell();

    expect(
      await screen.findByText("You are all caught up."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Loading notifications" }),
    ).not.toBeInTheDocument();
  });

  it("renders notifications once they arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          items: [
            {
              id: "n1",
              type: "system",
              payload: { message: "Welcome to KOOS" },
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
          unread: 1,
        }),
      ),
    );
    renderBell();
    await openBell();

    expect(await screen.findByText(/Welcome to KOOS/)).toBeInTheDocument();
    expect(
      screen.queryByText("You are all caught up."),
    ).not.toBeInTheDocument();
  });

  /* The unread badge must not appear before data lands, or a fresh page claims
     unread notifications it has not fetched. */
  it("claims no unread count until data arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderBell();
    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /unread/ }),
      ).not.toBeInTheDocument(),
    );
  });
});
