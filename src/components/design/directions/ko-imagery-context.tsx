"use client";

import { createContext, useContext } from "react";

/* FEATURE_KO_IMAGERY is read on the server (src/lib/design/ko-imagery-flag.ts)
   and handed down by each page that can open the image-choice dialog. The
   dialog sits three components below the calendar and strategy pages, so the
   flag travels by context rather than through every layer's props. Without a
   provider it reads false: a surface that forgets to pass the flag hides KO
   imagery rather than offering a choice the server refuses. */
const KoImageryContext = createContext(false);

export function KoImageryProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <KoImageryContext.Provider value={enabled}>
      {children}
    </KoImageryContext.Provider>
  );
}

export function useKoImageryOffered(): boolean {
  return useContext(KoImageryContext);
}
