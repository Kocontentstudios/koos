import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./proposal-card";

describe("ProposalCard", () => {
  it("shows the summary and confirms via the endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Set tone to bold",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    expect(screen.getByText("Set tone to bold")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/actions/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("confirmed"));
    vi.unstubAllGlobals();
  });

  it("sends the brandId and proposal as the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const proposal = {
      kind: "brand_fields" as const,
      summary: "Set tone to bold",
      data: { fields: { tone: "bold" } },
    };
    render(
      <ProposalCard brandId="brand-42" onDone={vi.fn()} proposal={proposal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/actions/confirm",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: "brand-42", proposal }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("dismisses without calling the server", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Set tone to bold",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDone).toHaveBeenCalledWith("dismissed");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows an error toast and does not call onDone when confirm fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Something broke" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Set tone to bold",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm/i }),
      ).not.toBeDisabled(),
    );
    expect(onDone).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
