"use client";

import { createContext, useContext } from "react";

/* FEATURE_MULTI_FRAME is read on the server (src/lib/design/multi-frame-flag.ts)
   and handed down the way KoImageryProvider hands down FEATURE_KO_IMAGERY.
   With it on, a carousel or presentation brief is certain to be built as a
   set, so the dialog can open the set's wait before the job's first report.
   Without a provider it reads false and the dialog tells the run nothing:
   the run then learns it is a set from the job's own progress, and a
   flag-off brief keeps exactly the wait it always had. */
const MultiFrameContext = createContext(false);

export function MultiFrameProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <MultiFrameContext.Provider value={enabled}>
      {children}
    </MultiFrameContext.Provider>
  );
}

export function useMultiFrameOffered(): boolean {
  return useContext(MultiFrameContext);
}
