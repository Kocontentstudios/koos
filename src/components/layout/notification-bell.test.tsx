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

describe("NotificationBell links", () => {
  const TICKET = "11111111-2222-3333-4444-555555555555";

  const item = (over: Record<string, unknown> = {}) => ({
    id: "n1",
    type: "design_ready",
    payload: { ticketId: TICKET },
    readAt: null,
    createdAt: new Date().toISOString(),
    href: `/design-request/${TICKET}`,
    ...over,
  });

  const stub = (items: unknown[]) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ items, unread: 0 })),
    );

  it("renders a notification as a link to the href the server resolved", async () => {
    stub([item()]);
    renderBell();
    await openBell();

    const link = await screen.findByRole("menuitem", {
      name: /Your design is ready for review/,
    });
    expect(link).toHaveAttribute("href", `/design-request/${TICKET}`);
  });

  /* The destination is role-dependent — staff go to the admin queue — and the
     component must render whatever the server resolved rather than deciding. */
  it("follows the server's href for a staff viewer", async () => {
    stub([item({ href: `/admin/tickets/${TICKET}` })]);
    renderBell();
    await openBell();

    expect(
      await screen.findByRole("menuitem", {
        name: /Your design is ready for review/,
      }),
    ).toHaveAttribute("href", `/admin/tickets/${TICKET}`);
  });

  it("leaves a notification with no target as inert text, not a dead link", async () => {
    stub([
      item({
        type: "system",
        payload: { message: "Scheduled maintenance tonight." },
        href: null,
      }),
    ]);
    renderBell();
    await openBell();

    expect(
      await screen.findByText("Scheduled maintenance tonight."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
