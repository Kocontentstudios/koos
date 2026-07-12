import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsClient } from "./settings-client";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

let originalLocation: Location;

afterEach(() => {
  refreshMock.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalLocation) {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  }
});

const workspace = { id: "ws-1", name: "KO Content Studio", logoUrl: null };

describe("SettingsClient", () => {
  it("disables the confirm-delete button until the typed name matches exactly", async () => {
    const user = userEvent.setup();
    render(
      <SettingsClient workspace={workspace} brandCount={2} canDelete={true} />,
    );

    await user.click(screen.getByRole("button", { name: /delete workspace/i }));

    const confirmInput = await screen.findByLabelText(
      /type the workspace name to confirm deletion/i,
    );
    // Two "Delete Workspace" buttons now exist (Danger Zone trigger + dialog
    // confirm); the confirm button is inside the dialog.
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: /delete workspace permanently/i,
    });
    expect(confirmButton).toBeDisabled();

    await user.type(confirmInput, "wrong name");
    expect(confirmButton).toBeDisabled();

    await user.clear(confirmInput);
    await user.type(confirmInput, workspace.name);
    expect(confirmButton).toBeEnabled();
  });

  it("disables the Danger Zone delete trigger when canDelete is false", () => {
    render(
      <SettingsClient workspace={workspace} brandCount={1} canDelete={false} />,
    );

    expect(
      screen.getByRole("button", { name: /delete workspace/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/you can't delete your only workspace/i),
    ).toBeInTheDocument();
  });

  it("hard-reloads to /dashboard on successful delete", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const assignMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: assignMock },
      writable: true,
      configurable: true,
    });

    render(
      <SettingsClient workspace={workspace} brandCount={0} canDelete={true} />,
    );

    await user.click(screen.getByRole("button", { name: /delete workspace/i }));
    const confirmInput = await screen.findByLabelText(
      /type the workspace name to confirm deletion/i,
    );
    await user.type(confirmInput, workspace.name);

    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: /delete workspace permanently/i,
      }),
    );

    await vi.waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith("/dashboard"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("shows the error message on a failed delete and does not reload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "You do not have permission." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const assignMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: assignMock },
      writable: true,
      configurable: true,
    });

    render(
      <SettingsClient workspace={workspace} brandCount={2} canDelete={true} />,
    );

    await user.click(screen.getByRole("button", { name: /delete workspace/i }));
    let confirmInput = await screen.findByLabelText(
      /type the workspace name to confirm deletion/i,
    );
    await user.type(confirmInput, workspace.name);

    let dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: /delete workspace permanently/i,
      }),
    );

    expect(
      await screen.findByText(/you do not have permission/i),
    ).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();

    // Verify that after the failed delete, reopening the dialog shows
    // the confirm input empty and the confirm button disabled
    await user.click(screen.getByRole("button", { name: /delete workspace/i }));
    confirmInput = await screen.findByLabelText(
      /type the workspace name to confirm deletion/i,
    );
    expect(confirmInput).toHaveValue("");

    dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", {
        name: /delete workspace permanently/i,
      }),
    ).toBeDisabled();
  });

  it("resets the typed confirmation text when the delete dialog is closed and reopened", async () => {
    const user = userEvent.setup();
    render(
      <SettingsClient workspace={workspace} brandCount={2} canDelete={true} />,
    );

    await user.click(screen.getByRole("button", { name: /delete workspace/i }));
    let confirmInput = await screen.findByLabelText(
      /type the workspace name to confirm deletion/i,
    );
    await user.type(confirmInput, workspace.name);

    let dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", {
        name: /delete workspace permanently/i,
      }),
    ).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await user.click(screen.getByRole("button", { name: /delete workspace/i }));
    confirmInput = await screen.findByLabelText(
      /type the workspace name to confirm deletion/i,
    );
    expect(confirmInput).toHaveValue("");

    dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", {
        name: /delete workspace permanently/i,
      }),
    ).toBeDisabled();
  });
});
