import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// vi.mock is hoisted above const declarations, so the spies must be too.
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { CommentComposer } from "./comment-composer";

const ok = () => ({ ok: true, json: async () => ({ update: { id: "u1" } }) });

/** The (url, init) pair of a fetch call, typed so the assertions don't cast. */
function callOf(mock: { mock: { calls: unknown[][] } }, index = 0) {
  const [url, init] = mock.mock.calls[index] as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)), method: init.method };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CommentComposer", () => {
  it("posts the comment to the ticket and refreshes the timeline", async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommentComposer ticketId="t-1" />);

    await user.type(
      screen.getByLabelText("Add a comment"),
      "Please make the logo bigger.",
    );
    await user.click(screen.getByRole("button", { name: /send comment/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = callOf(fetchMock);
    expect(call.url).toBe("/api/design-tickets/t-1");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ message: "Please make the logo bigger." });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /* The review actions own status transitions. A comment that could carry one
     would give the client a second, unguarded way to reopen a ticket. */
  it("never sends a status with the comment", async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommentComposer ticketId="t-1" />);

    await user.type(screen.getByLabelText("Add a comment"), "A note");
    await user.click(screen.getByRole("button", { name: /send comment/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(Object.keys(callOf(fetchMock).body)).toEqual(["message"]);
  });

  it("clears the box after a successful send", async () => {
    vi.stubGlobal("fetch", vi.fn(ok));
    const user = userEvent.setup();
    render(<CommentComposer ticketId="t-1" />);

    const box = screen.getByLabelText("Add a comment");
    await user.type(box, "Looks great");
    await user.click(screen.getByRole("button", { name: /send comment/i }));

    await waitFor(() => expect(box).toHaveValue(""));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("keeps the send button disabled until there is something to send", async () => {
    vi.stubGlobal("fetch", vi.fn(ok));
    const user = userEvent.setup();
    render(<CommentComposer ticketId="t-1" />);

    const send = screen.getByRole("button", { name: /send comment/i });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Add a comment"), "   ");
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Add a comment"), "real text");
    expect(send).toBeEnabled();
  });

  it("surfaces the server's error and keeps the text so it is not lost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error: "Keep your comment under 2000 characters.",
        }),
      })),
    );
    const user = userEvent.setup();
    render(<CommentComposer ticketId="t-1" />);

    await user.type(screen.getByLabelText("Add a comment"), "too long");
    await user.click(screen.getByRole("button", { name: /send comment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Keep your comment under 2000 characters.",
    );
    expect(screen.getByLabelText("Add a comment")).toHaveValue("too long");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a network failure rather than failing silently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const user = userEvent.setup();
    render(<CommentComposer ticketId="t-1" />);

    await user.type(screen.getByLabelText("Add a comment"), "hello");
    await user.click(screen.getByRole("button", { name: /send comment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /network error/i,
    );
    expect(toastError).toHaveBeenCalled();
  });
});
