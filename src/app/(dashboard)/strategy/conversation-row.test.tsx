import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type ConversationListItem,
  ConversationRow,
  conversationLabel,
} from "./conversation-row";

const conversation: ConversationListItem = {
  id: "c1",
  title: "Ramadan Gift Bundles",
  updatedAt: new Date("2026-08-25T10:00:00.000Z"),
  mode: "strategy",
  strategyId: "s1",
};

function renderRow(
  overrides: Partial<ConversationListItem> = {},
  props: { onRename?: (id: string, t: string) => Promise<boolean> } = {},
) {
  const onSelect = vi.fn();
  const onRename = props.onRename ?? vi.fn().mockResolvedValue(true);
  render(
    <ul>
      <ConversationRow
        conversation={{ ...conversation, ...overrides }}
        active={false}
        loading={false}
        onSelect={onSelect}
        onRename={onRename}
      />
    </ul>,
  );
  return { onSelect, onRename };
}

describe("conversationLabel", () => {
  it("uses the chat title when it has one", () => {
    expect(conversationLabel(conversation)).toBe("Ramadan Gift Bundles");
  });

  it("falls back to a dated label for an unnamed chat", () => {
    expect(conversationLabel({ ...conversation, title: null })).toContain(
      "Chat from",
    );
  });
});

describe("ConversationRow", () => {
  it("selects the chat when the row is clicked", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderRow();
    await user.click(screen.getByText("Ramadan Gift Bundles"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("badges a chat that produced a campaign", () => {
    renderRow();
    expect(screen.getByText("Campaign")).toBeInTheDocument();
  });

  it("commits a rename on Enter", async () => {
    const user = userEvent.setup();
    const { onRename, onSelect } = renderRow();

    await user.click(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    const input = screen.getByLabelText("Rename chat: Ramadan Gift Bundles");
    await user.clear(input);
    await user.type(input, "Eid Bundles{Enter}");

    expect(onRename).toHaveBeenCalledWith("c1", "Eid Bundles");
    // Opening the editor must never also open the chat.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("commits a rename from the confirm control", async () => {
    const user = userEvent.setup();
    const { onRename } = renderRow();
    await user.click(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    await user.clear(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    await user.type(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
      "Eid Bundles",
    );
    await user.click(screen.getByLabelText("Save chat name"));
    expect(onRename).toHaveBeenCalledWith("c1", "Eid Bundles");
  });

  it("abandons the rename on Escape", async () => {
    const user = userEvent.setup();
    const { onRename } = renderRow();
    await user.click(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    await user.type(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
      " scrapped{Escape}",
    );
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Ramadan Gift Bundles")).toBeInTheDocument();
  });

  it("trims and refuses an all-whitespace name", async () => {
    const user = userEvent.setup();
    const { onRename } = renderRow();
    await user.click(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    const input = screen.getByLabelText("Rename chat: Ramadan Gift Bundles");
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Give the chat a name.",
    );
  });

  it("keeps the editor open and says so when the rename fails", async () => {
    const user = userEvent.setup();
    renderRow({}, { onRename: vi.fn().mockResolvedValue(false) });
    await user.click(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    const input = screen.getByLabelText("Rename chat: Ramadan Gift Bundles");
    await user.clear(input);
    await user.type(input, "Eid Bundles{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not rename this chat.",
    );
    expect(input).toBeInTheDocument();
  });

  it("caps the typed title at the length the API accepts", async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    );
    expect(
      screen.getByLabelText("Rename chat: Ramadan Gift Bundles"),
    ).toHaveAttribute("maxLength", "80");
  });

  it("offers no rename control when renaming isn't wired up", () => {
    render(
      <ul>
        <ConversationRow
          conversation={conversation}
          active={false}
          loading={false}
          onSelect={vi.fn()}
        />
      </ul>,
    );
    expect(
      screen.queryByLabelText("Rename chat: Ramadan Gift Bundles"),
    ).not.toBeInTheDocument();
  });
});
