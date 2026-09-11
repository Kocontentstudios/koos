import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FontSlot, storedFontName, useFontSlots } from "./use-font-slots";

/* KOS-V1-FEAT-022. Both brand forms upload fonts through this hook, so its
   behaviour is the contract between them. Tested directly rather than only
   through a form, because a defect here surfaces as two different-looking
   bugs on two different screens. */

const writes: [string, string][] = [];

function Harness({ initial }: { initial?: Record<string, string | null> }) {
  const fonts = useFontSlots((field, value) => {
    writes.push([field, value]);
  }, initial ?? {});
  return (
    <div>
      {(["heading", "body"] as FontSlot[]).map((slot) => (
        <div key={slot}>
          <button
            type="button"
            onClick={() => fonts.select(slot, new File(["x"], `${slot}.ttf`))}
          >
            pick {slot}
          </button>
          <button type="button" onClick={() => fonts.remove(slot)}>
            drop {slot}
          </button>
          <span data-testid={`name-${slot}`}>{fonts.fileName[slot] ?? ""}</span>
          <span data-testid={`error-${slot}`}>{fonts.error[slot] ?? ""}</span>
        </div>
      ))}
      <span data-testid="busy">{fonts.busy ? "busy" : "idle"}</span>
    </div>
  );
}

const name = (slot: FontSlot) => screen.getByTestId(`name-${slot}`).textContent;
const error = (slot: FontSlot) =>
  screen.getByTestId(`error-${slot}`).textContent;

beforeEach(() => {
  writes.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://cdn.example.com/fonts/u1/new.ttf" }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFontSlots", () => {
  it("writes the uploaded URL to the slot's own column", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("pick body"));

    expect(writes).toEqual([
      ["bodyFontUrl", "https://cdn.example.com/fonts/u1/new.ttf"],
    ]);
  });

  /* An empty string, never undefined: the server reads omission as "leave it
     alone", so removal has to be an explicit clear (KOS-V1-BUG-020). */
  it("clears with an empty string rather than an omission", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("drop heading"));

    expect(writes).toEqual([["brandFontUrl", ""]]);
  });

  /* One shared value would make the heading field display the body field's
     filename and error, which is how a user ends up replacing the wrong one. */
  it("keeps each slot's filename and error to itself", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "brand.ttf can't be used: it is broken." }),
      })),
    );
    render(<Harness />);

    await userEvent.click(screen.getByText("pick heading"));

    expect(error("heading")).toMatch(/can't be used/);
    expect(error("body")).toBe("");
    /* The refused file must not sit there looking attached. */
    expect(name("heading")).toBe("");
  });

  it("prefers the server's message, which names the file and the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error: "Acme.ttf can't be used: it is truncated.",
        }),
      })),
    );
    render(<Harness />);

    await userEvent.click(screen.getByText("pick heading"));

    expect(error("heading")).toBe("Acme.ttf can't be used: it is truncated.");
  });

  it("falls back to its own message when the server sends none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<Harness />);

    await userEvent.click(screen.getByText("pick heading"));

    expect(error("heading")).toMatch(/could not upload/i);
    expect(writes).toEqual([["brandFontUrl", ""]]);
  });

  /* busy drives a single shared status line, so a slot missing from it means
     one of the two uploads happens with no visible progress at all. */
  it.each([["heading"], ["body"]] as [FontSlot][])(
    "reports busy while the %s slot uploads",
    async (slot) => {
      let release: (value: unknown) => void = () => {};
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        ),
      );
      render(<Harness />);

      await userEvent.click(screen.getByText(`pick ${slot}`));
      expect(screen.getByTestId("busy").textContent).toBe("busy");

      release({ ok: true, json: async () => ({ url: "https://x/y.ttf" }) });
    },
  );

  it("shows a stored font as already set", () => {
    render(<Harness initial={{ heading: "Current font (.ttf)" }} />);

    expect(name("heading")).toBe("Current font (.ttf)");
    expect(name("body")).toBe("");
  });
});

describe("storedFontName", () => {
  it("names the format a stored font is in", () => {
    expect(storedFontName("https://cdn.example.com/f/u1/1736-a1.ttf")).toBe(
      "Current font (.ttf)",
    );
  });

  it.each([
    ["a query string", "https://cdn/f/a.otf?v=2", "Current font (.otf)"],
    ["an uppercase extension", "https://cdn/f/A.TTF", "Current font (.ttf)"],
    ["dots in the path", "https://cdn/f.v2/u.1/a.ttf", "Current font (.ttf)"],
    ["no extension at all", "https://cdn/f/a", "Current font"],
  ])("handles %s", (_label, url, expected) => {
    expect(storedFontName(url)).toBe(expected);
  });

  it.each([[null], [undefined], [""]])("treats %s as no font", (value) => {
    expect(storedFontName(value)).toBeNull();
  });
});
