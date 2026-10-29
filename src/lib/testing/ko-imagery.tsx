import { KoImageryProvider } from "@/components/design/directions/ko-imagery-context";

/** Render options that set FEATURE_KO_IMAGERY the way the server pages do:
 *  `render(ui, withKoImagery(true))`. */
export function withKoImagery(enabled: boolean) {
  return {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <KoImageryProvider enabled={enabled}>{children}</KoImageryProvider>
    ),
  };
}
