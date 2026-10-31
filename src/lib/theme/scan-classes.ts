import type ts from "typescript";
import { parseColor } from "./color";
import {
  type Box,
  type Context,
  emptyBox,
  type Paint,
  PSEUDO,
  paintFrom,
  unmeasured,
} from "./scan-model";

/** Splits `group-hover:bg-primary` into its variants and its utility. A colon
 * inside an arbitrary-value bracket is part of a selector, not a separator. */
export function splitVariants(token: string): {
  variants: string[];
  utility: string;
} {
  const variants: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) {
      variants.push(token.slice(start, i));
      start = i + 1;
    }
  }
  return { variants, utility: token.slice(start) };
}

/** The colour a `prefix-*` utility paints, as a CSS value, and its alpha. */
export function utilityColor(
  ctx: Context,
  prefix: string,
  utility: string,
): { value: string; alpha: number } | null {
  const bare = utility.replace(/^!|!$/g, "");
  if (!bare.startsWith(`${prefix}-`)) return null;
  let rest = bare.slice(prefix.length + 1);
  let alpha = 1;
  const slash = /\/(\d+(?:\.\d+)?|\[[\d.]+%?\])$/.exec(rest);
  if (slash && !/^\[[^\]]*$/.test(rest.slice(0, slash.index))) {
    const raw = slash[1].replace(/^\[|\]$/g, "");
    alpha = raw.endsWith("%")
      ? Number.parseFloat(raw) / 100
      : raw.includes(".")
        ? Number(raw)
        : Number(raw) / 100;
    rest = rest.slice(0, slash.index);
  }
  if (rest.startsWith("[") && rest.endsWith("]")) {
    let inner = rest.slice(1, -1).replace(/_/g, " ");
    const hint = /^([a-z-]+):(?!\/)/.exec(inner);
    if (hint) {
      if (hint[1] !== "color") return null;
      inner = inner.slice(hint[0].length);
    }
    return { value: inner, alpha };
  }
  if (rest.startsWith("(") && rest.endsWith(")")) {
    let inner = rest.slice(1, -1);
    const hint = /^([a-z-]+):/.exec(inner);
    if (hint) {
      if (hint[1] !== "color") return null;
      inner = inner.slice(hint[0].length);
    }
    return { value: `var(${inner})`, alpha };
  }
  if (parseColor(rest)) return { value: rest, alpha };
  if (ctx.themes.dark.has(`--color-${rest}`)) {
    return { value: `var(--color-${rest})`, alpha };
  }
  return null;
}

export interface Piece {
  text: string;
  cond: ts.Node | null;
}

export function boxesFromClasses(
  ctx: Context,
  pieces: Piece[],
): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const boxFor = (key: string) => {
    let box = boxes.get(key);
    if (!box) {
      box = emptyBox();
      boxes.set(key, box);
    }
    return box;
  };
  for (const piece of pieces) {
    for (const token of piece.text.split(/\s+/).filter(Boolean)) {
      const { variants, utility } = splitVariants(token);
      const key = variants.find((v) => PSEUDO.test(v)) ?? "";
      const state = variants.filter((v) => !PSEUDO.test(v));
      const box = boxFor(key);
      const add = (prefix: string, into: Paint[]) => {
        const hit = utilityColor(ctx, prefix, utility);
        if (!hit) return false;
        const paint = paintFrom(
          ctx,
          hit.value,
          hit.alpha,
          token,
          piece.cond,
          undefined,
          state,
        );
        if (paint) into.push(paint);
        return Boolean(paint);
      };
      if (/^!?bg-clip-text!?$/.test(utility)) box.clipText = true;
      else if (/^!?content-/.test(utility)) {
        box.content = !/^!?content-(?:none|\[(?:''|""|none)\])!?$/.test(
          utility,
        );
      } else if (/^!?(?:from|via|to)-/.test(utility)) {
        const prefix = utility.replace(/^!/, "").split("-")[0];
        if (!add(prefix, box.stops) && !/^!?\w+-\d+%$/.test(utility)) {
          box.stops.push(unmeasured(token, piece.cond, state));
        }
      } else if (!add("bg", box.grounds) && !add("text", box.texts)) {
        add("fill", box.fills);
      }
    }
  }
  return boxes;
}
