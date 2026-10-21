import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  EscapeLayerProvider,
  useEscapeLayer,
  useEscapeLayerStack,
} from "./escape-layer";

function Layer({
  name,
  onEscape,
  initiallyOpen = true,
}: {
  name: string;
  onEscape: (name: string) => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  useEscapeLayer(open, () => {
    onEscape(name);
    setOpen(false);
  });
  return open ? <p>{name} open</p> : null;
}

function Harness({
  onEscape,
  expose,
  children,
}: {
  onEscape: (name: string) => void;
  expose: (dismiss: () => boolean) => void;
  children?: React.ReactNode;
}) {
  const layers = useEscapeLayerStack();
  expose(layers.dismissInnermost);
  return (
    <EscapeLayerProvider value={layers.stack}>
      <Layer name="outer" onEscape={onEscape} />
      <Layer name="inner" onEscape={onEscape} />
      {children}
    </EscapeLayerProvider>
  );
}

describe("escape layers", () => {
  it("dismisses the innermost open layer first, then reports none left", () => {
    const onEscape = vi.fn();
    let dismiss: () => boolean = () => false;
    const view = render(
      <Harness onEscape={onEscape} expose={(d) => (dismiss = d)} />,
    );

    act(() => {
      expect(dismiss()).toBe(true);
    });
    expect(onEscape).toHaveBeenLastCalledWith("inner");
    expect(view.queryByText("inner open")).toBeNull();
    expect(view.getByText("outer open")).toBeInTheDocument();

    act(() => {
      expect(dismiss()).toBe(true);
    });
    expect(onEscape).toHaveBeenLastCalledWith("outer");

    act(() => {
      expect(dismiss()).toBe(false);
    });
    expect(onEscape).toHaveBeenCalledTimes(2);
  });

  it("ignores a closed layer and works with no provider at all", () => {
    const onEscape = vi.fn();
    let dismiss: () => boolean = () => false;
    render(
      <Harness onEscape={onEscape} expose={(d) => (dismiss = d)}>
        <Layer name="closed" onEscape={onEscape} initiallyOpen={false} />
      </Harness>,
    );
    act(() => {
      dismiss();
    });
    expect(onEscape).toHaveBeenLastCalledWith("inner");

    expect(() =>
      render(<Layer name="orphan" onEscape={onEscape} />),
    ).not.toThrow();
  });
});
