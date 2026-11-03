import { type DesignSet, frameState, kindNoun } from "./set-model";

export interface SetHeading {
  title: string;
  description: string;
}

/** The heading over a set says what is actually on screen, as the
 *  directions heading does: a carousel with a failed frame is not "ready". */
export function setHeading(set: DesignSet): SetHeading {
  const count = set.frames.length;
  const noun = kindNoun(set.kind);
  const broken = set.frames.filter((slot) => {
    const state = frameState(slot);
    return state === "failed" || state === "missing";
  }).length;
  const title = `Your ${count}-slide ${noun}`;
  if (broken === 0) {
    return {
      title,
      description:
        "Swipe through it as it will be posted. Pick a frame to edit its words or regenerate it; the others stay as they are.",
    };
  }
  return {
    title,
    description:
      broken === 1
        ? "One frame didn't render. Retry it from its place in the rail; the others are ready."
        : `${broken} frames didn't render. Retry each from its place in the rail; the others are ready.`,
  };
}
