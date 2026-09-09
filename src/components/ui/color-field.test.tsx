import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ColorField } from "./color-field";

function colorInputIn(container: HTMLElement) {
  const input = container.querySelector('input[type="color"]');
  if (!input) throw new Error("no native colour input rendered");
  return input as HTMLInputElement;
}

describe("ColorField", () => {
  it("renders the label and the current value", () => {
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Primary colour")).toHaveValue("#138BC8");
  });

  it("opens the native colour picker from the swatch", async () => {
    const { container } = render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={() => {}}
      />,
    );
    const click = vi.spyOn(colorInputIn(container), "click");
    await userEvent.click(
      screen.getByRole("button", { name: "Pick Primary colour" }),
    );
    expect(click).toHaveBeenCalled();
  });

  it("commits a normalised hex when a colour is picked from the wheel", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={onChange}
      />,
    );
    fireEvent.change(colorInputIn(container), {
      target: { value: "#00ff00" },
    });
    expect(onChange).toHaveBeenCalledWith("#00FF00");
  });

  it("paints the swatch with a hex value", () => {
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="#00FF00"
        onChange={() => {}}
      />,
    );
    // Inline style, not toHaveStyle: jsdom's computed style drops
    // `transparent`, so the unpainted case below can only be read here.
    expect(
      screen.getByRole("button", { name: "Pick Primary colour" }).style
        .backgroundColor,
    ).toBe("rgb(0, 255, 0)");
  });

  describe("strict mode (the default)", () => {
    it("normalises a shorthand hex on blur", async () => {
      const onChange = vi.fn();
      render(
        <ColorField
          id="primary"
          label="Primary"
          value="#138BC8"
          onChange={onChange}
        />,
      );
      const input = screen.getByLabelText("Primary colour");
      await userEvent.clear(input);
      await userEvent.type(input, "0f0");
      await userEvent.tab();
      expect(onChange).toHaveBeenCalledWith("#00FF00");
      expect(input).toHaveValue("#00FF00");
    });

    it("reverts text that is not a hex code", async () => {
      const onChange = vi.fn();
      render(
        <ColorField
          id="primary"
          label="Primary"
          value="#138BC8"
          onChange={onChange}
        />,
      );
      const input = screen.getByLabelText("Primary colour");
      await userEvent.clear(input);
      await userEvent.type(input, "forest green");
      await userEvent.tab();
      expect(onChange).not.toHaveBeenCalled();
      expect(input).toHaveValue("#138BC8");
    });
  });

  describe("free-text mode", () => {
    /* The conversational onboarding path legitimately stores colour NAMES:
       parseAdditionalColors never hex-validates, and the paid onboarding eval
       asserts primaryColor contains "green". Reverting them would silently
       destroy what the user actually said. */
    it("keeps a colour name on blur", async () => {
      const onChange = vi.fn();
      render(
        <ColorField
          id="primary"
          label="Primary"
          value=""
          allowFreeText
          onChange={onChange}
        />,
      );
      const input = screen.getByLabelText("Primary colour");
      await userEvent.type(input, "forest green");
      await userEvent.tab();
      expect(onChange).toHaveBeenCalledWith("forest green");
      expect(input).toHaveValue("forest green");
    });

    it("still normalises a hex code on blur", async () => {
      const onChange = vi.fn();
      render(
        <ColorField
          id="primary"
          label="Primary"
          value=""
          allowFreeText
          onChange={onChange}
        />,
      );
      const input = screen.getByLabelText("Primary colour");
      await userEvent.type(input, "0f0");
      await userEvent.tab();
      expect(onChange).toHaveBeenCalledWith("#00FF00");
      expect(input).toHaveValue("#00FF00");
    });

    it("leaves the swatch unpainted for a value that is not a hex code", () => {
      render(
        <ColorField
          id="primary"
          label="Primary"
          value="forest green"
          allowFreeText
          onChange={() => {}}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Pick Primary colour" }).style
          .backgroundColor,
      ).toBe("transparent");
    });

    it("reports a cleared field rather than restoring the old value", async () => {
      const onChange = vi.fn();
      render(
        <ColorField
          id="primary"
          label="Primary"
          value="forest green"
          allowFreeText
          onChange={onChange}
        />,
      );
      const input = screen.getByLabelText("Primary colour");
      await userEvent.clear(input);
      await userEvent.tab();
      expect(onChange).toHaveBeenCalledWith("");
      expect(input).toHaveValue("");
    });
  });
});

/* A form control inside a <button> is invalid HTML, and a real click lands on
   both: the input opens the picker itself, then the bubbled click tells the
   button to open it again. The input is a sibling, driven by ref. */
describe("ColorField markup", () => {
  it("keeps the native colour input outside the swatch button", () => {
    const { container } = render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Pick Primary colour" });
    expect(button.querySelector('input[type="color"]')).toBeNull();
    expect(colorInputIn(container)).toBeInTheDocument();
  });
});

describe("ColorField affordance", () => {
  it("shows a colour-wheel icon on the swatch", () => {
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={() => {}}
      />,
    );
    // The specific icon, not just "an svg": the ticket's deliverable is a
    // colour wheel, and any icon at all would satisfy a bare svg query.
    const button = screen.getByRole("button", { name: "Pick Primary colour" });
    expect(button.querySelector("svg.lucide-palette")).toBeInTheDocument();
  });

  /* An unset colour paints nothing, so without a marked-up "empty" state the
     swatch is an invisible box and the wheel has no affordance at all. */
  it("marks the swatch as empty when there is no colour to show", () => {
    render(
      <ColorField id="primary" label="Primary" value="" onChange={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Pick Primary colour" }),
    ).toHaveAttribute("data-empty", "true");
  });

  it("does not mark a painted swatch as empty", () => {
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Pick Primary colour" }),
    ).toHaveAttribute("data-empty", "false");
  });

  it("shows the placeholder it was given", () => {
    render(
      <ColorField
        id="primary"
        label="Primary"
        value=""
        placeholder="#000000 or a colour name"
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Primary colour")).toHaveAttribute(
      "placeholder",
      "#000000 or a colour name",
    );
  });
});

describe("ColorField editing", () => {
  /* "Pick from logo" writes primaryColor from an async fetch. Resyncing the
     text while the user is mid-word would delete what they were typing. */
  it("does not overwrite in-progress typing when the value changes externally", async () => {
    let extract = (_: string) => {};
    function Harness() {
      const [value, setValue] = useState("");
      extract = setValue;
      return (
        <ColorField
          id="primary"
          label="Primary"
          value={value}
          allowFreeText
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Primary colour");
    await userEvent.click(input);
    await userEvent.keyboard("forest gr");

    // The logo extraction resolving — focus never leaves the field.
    act(() => extract("#ABCDEF"));

    expect(input).toHaveValue("forest gr");
  });

  it("takes an external value once the field is no longer being edited", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <>
          <button type="button" onClick={() => setValue("#ABCDEF")}>
            extract
          </button>
          <ColorField
            id="primary"
            label="Primary"
            value={value}
            allowFreeText
            onChange={setValue}
          />
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "extract" }));
    expect(screen.getByLabelText("Primary colour")).toHaveValue("#ABCDEF");
  });

  it("does not report a blur that changed nothing", async () => {
    const onChange = vi.fn();
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="forest green"
        allowFreeText
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByLabelText("Primary colour"));
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reverts an emptied field in strict mode", async () => {
    const onChange = vi.fn();
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="#138BC8"
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Primary colour");
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input).toHaveValue("#138BC8");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats whitespace as a cleared field in free-text mode", async () => {
    const onChange = vi.fn();
    render(
      <ColorField
        id="primary"
        label="Primary"
        value="forest green"
        allowFreeText
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Primary colour");
    await userEvent.clear(input);
    await userEvent.type(input, "   ");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("");
  });
});

/* Documented, not accidental: normalizeHex is the app-wide rule and
   paletteSwatches applies it downstream too, so a stored "bee" would render as
   #BBEEEE either way. Free-text mode preserves what cannot be read as a
   colour, not what merely looks like a word. */
describe("ColorField free-text and hex ambiguity", () => {
  it("reads a word that is also a valid hex code as a hex code", async () => {
    const onChange = vi.fn();
    render(
      <ColorField
        id="primary"
        label="Primary"
        value=""
        allowFreeText
        onChange={onChange}
      />,
    );
    await userEvent.type(screen.getByLabelText("Primary colour"), "bee");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("#BBEEEE");
  });

  it("keeps a word that cannot be read as a hex code", async () => {
    const onChange = vi.fn();
    render(
      <ColorField
        id="primary"
        label="Primary"
        value=""
        allowFreeText
        onChange={onChange}
      />,
    );
    await userEvent.type(screen.getByLabelText("Primary colour"), "faded");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("faded");
  });
});

/* The create form's default secondary colour is #FFFFFF, which a fixed white
   icon vanishes on. Expected inks are written out rather than recomputed from
   contrastRatio, so the test cannot agree with a broken inkFor. */
describe("ColorField icon contrast", () => {
  const inkOn = (value: string) => {
    const { unmount } = render(
      <ColorField id="c" label="Primary" value={value} onChange={() => {}} />,
    );
    const cls =
      screen
        .getByRole("button", { name: "Pick Primary colour" })
        .querySelector("svg")
        ?.getAttribute("class") ?? "";
    unmount();
    return cls.includes("text-black")
      ? "dark"
      : cls.includes("text-white")
        ? "light"
        : "muted";
  };

  it.each([
    ["#FFFFFF", "dark"],
    ["#FAF7F2", "dark"],
    ["#EAB308", "dark"],
    ["#138BC8", "dark"],
    ["#0F172A", "light"],
    ["forest green", "muted"],
  ])("inks %s with %s", (swatch, expected) => {
    expect(inkOn(swatch)).toBe(expected);
  });
});

describe("ColorField accessible naming", () => {
  it("takes the spelling of the noun from the screen it is on", () => {
    render(
      <ColorField
        id="c"
        label="Primary"
        value="#138BC8"
        noun="color"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Pick Primary color" }),
    ).toBeInTheDocument();
  });
});

describe("ColorField external updates", () => {
  function Harness({ onCommit }: { onCommit?: (v: string) => void }) {
    const [value, setValue] = useState("");
    externalSet = setValue;
    return (
      <>
        <ColorField
          id="primary"
          label="Primary"
          value={value}
          allowFreeText
          onChange={(v) => {
            setValue(v);
            onCommit?.(v);
          }}
        />
        <button type="button">elsewhere</button>
      </>
    );
  }
  let externalSet: (v: string) => void = () => {};

  /* "Pick from logo" is a multi-second fetch, so a user can easily be sitting
     in the field when it resolves. Blurring must not push the stale text back
     over the colour that just arrived. */
  it("keeps a colour that arrived while the field merely had focus", async () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByLabelText("Primary colour");

    await userEvent.click(input);
    act(() => externalSet("#3A2A1F"));
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(input).toHaveValue("#3A2A1F");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("still commits what the user actually typed over a late arrival", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Primary colour");

    await userEvent.click(input);
    await userEvent.keyboard("forest green");
    act(() => externalSet("#3A2A1F"));
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(input).toHaveValue("forest green");
  });
});

/* The create form passes `state.primaryColor || "#138BC8"`, so `value` is a
   display fallback the parent has NOT stored. Committing the very colour the
   swatch is showing must still reach the parent, or the brand saves null while
   the UI showed blue the whole time. */
describe("ColorField against a display fallback", () => {
  function Harness() {
    const [stored, setStored] = useState("");
    committed = stored;
    return (
      <ColorField
        id="primary"
        label="Primary"
        value={stored || "#138BC8"}
        onChange={setStored}
      />
    );
  }
  let committed = "";

  it("commits a hex that matches the displayed fallback", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Primary colour");
    await userEvent.clear(input);
    await userEvent.type(input, "138bc8");
    await userEvent.tab();
    expect(committed).toBe("#138BC8");
  });

  it("still reports nothing when the field is only visited", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText("Primary colour"));
    await userEvent.tab();
    expect(committed).toBe("");
  });
});

/* An edit that nets back to the original is still an edit: it is the user
   deciding to keep what was there, and a late external write must not win. */
describe("ColorField edits that net back", () => {
  it("keeps a name the user retyped over a late external value", async () => {
    let external = (_: string) => {};
    let seen = "forest green";
    function Harness() {
      const [value, setValue] = useState("forest green");
      external = setValue;
      seen = value;
      return (
        <>
          <ColorField
            id="primary"
            label="Primary"
            value={value}
            allowFreeText
            onChange={setValue}
          />
          <button type="button">elsewhere</button>
        </>
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Primary colour");

    await userEvent.clear(input);
    await userEvent.type(input, "forest green");
    act(() => external("#ABCDEF"));
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(seen).toBe("forest green");
  });
});

describe("ColorField wheel and text together", () => {
  it("lets a wheel pick win over text the user had started", async () => {
    let committed = "";
    function Harness() {
      const [value, setValue] = useState("");
      committed = value;
      return (
        <ColorField
          id="primary"
          label="Primary"
          value={value}
          allowFreeText
          onChange={setValue}
        />
      );
    }
    const { container } = render(<Harness />);
    const input = screen.getByLabelText("Primary colour");

    await userEvent.click(input);
    await userEvent.keyboard("forest");
    fireEvent.change(colorInputIn(container), { target: { value: "#00ff00" } });
    await userEvent.tab();

    expect(committed).toBe("#00FF00");
    expect(input).toHaveValue("#00FF00");
  });

  it("adopts the latest of several values that arrive while focused", async () => {
    let external = (_: string) => {};
    function Harness() {
      const [value, setValue] = useState("");
      external = setValue;
      return (
        <>
          <ColorField
            id="primary"
            label="Primary"
            value={value}
            allowFreeText
            onChange={setValue}
          />
          <button type="button">elsewhere</button>
        </>
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Primary colour");

    await userEvent.click(input);
    act(() => external("#111111"));
    act(() => external("#222222"));
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(input).toHaveValue("#222222");
  });
});
