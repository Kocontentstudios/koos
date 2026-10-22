import path from "node:path";
import { describe, expect, it } from "vitest";
import { functionPropsCrossing, serverModules } from "./function-props";

const SRC = path.resolve(import.meta.dirname, "../..");
const rel = (file: string) => path.relative(SRC, file);

const scan = (source: string) =>
  functionPropsCrossing("/fixture/page.tsx", source).map(
    (c) => `${c.element}.${c.prop}`,
  );

describe("server modules", () => {
  const modules = serverModules(SRC).map(rel);

  /* Round 3's crash sites: each renders <Button> from a Server Component. */
  it.each([
    "app/(dashboard)/brand/page.tsx",
    "app/(dashboard)/calendar/page.tsx",
    "app/(dashboard)/no-brands/page.tsx",
    "app/(dashboard)/not-found.tsx",
    "components/ui/button.tsx",
  ])("include %s", (file) => {
    expect(modules).toContain(file);
  });

  it("stop at a use client module", () => {
    expect(modules).not.toContain("components/ui/button-control.tsx");
  });

  it("pass no function to a Client Component or a DOM element", () => {
    const crossings = serverModules(SRC).flatMap((file) =>
      functionPropsCrossing(file).map(
        (c) => `${rel(c.file)}:${c.line} <${c.element} ${c.prop}>`,
      ),
    );
    expect(crossings).toEqual([]);
  });
});

describe("functionPropsCrossing", () => {
  it("flags round 3's Button: a local handler on the client primitive", () => {
    expect(
      scan(`
        export function Button({ loading, onClick, ...props }) {
          const swallowWhileLoading = (event) => {
            if (loading) return event.preventDefault();
            onClick?.(event);
          };
          return <ButtonPrimitive {...props} onClick={swallowWhileLoading} />;
        }`),
    ).toEqual(["ButtonPrimitive.onClick"]);
  });

  it("flags a handler chosen by a condition, since the condition can be true on the server", () => {
    expect(
      scan(`
        function swallow() {}
        export function Button({ loading, onClick }) {
          return <ButtonPrimitive onClick={loading ? swallow : onClick} />;
        }`),
    ).toEqual(["ButtonPrimitive.onClick"]);
  });

  it("flags inline arrows, bound functions and render-prop children", () => {
    expect(
      scan(`
        function track() {}
        export default function Page() {
          return (
            <main>
              <button onClick={() => track()}>Go</button>
              <Link onMouseEnter={track.bind(null)} href="/x">X</Link>
              <Menu>{(open) => <span>{open}</span>}</Menu>
            </main>
          );
        }`),
    ).toEqual(["button.onClick", "Link.onMouseEnter", "Menu.children"]);
  });

  it("allows server actions, inline or declared", () => {
    expect(
      scan(`
        async function save() { "use server"; }
        export default function Page() {
          return (
            <form action={save}>
              <button formAction={async () => { "use server"; }}>Save</button>
            </form>
          );
        }`),
    ).toEqual([]);
  });

  it("leaves a prop the component was given to its caller", () => {
    expect(
      scan(`
        export function Button({ onClick, ...rest }) {
          return <ButtonControl onClick={onClick} {...rest} />;
        }`),
    ).toEqual([]);
  });

  it("resolves a shadowing parameter before an outer function of the same name", () => {
    expect(
      scan(`
        function onClick() {}
        export function Row({ onClick }) {
          return <button onClick={onClick} />;
        }`),
    ).toEqual([]);
  });

  it("skips a use client module, where functions are props like any other", () => {
    expect(
      scan(`"use client";
        export function Toggle() {
          return <button onClick={() => {}} />;
        }`),
    ).toEqual([]);
  });
});
