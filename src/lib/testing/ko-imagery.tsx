import { KoImageryProvider } from "@/components/design/directions/ko-imagery-context";
import { MultiFrameProvider } from "@/components/design/directions/multi-frame-context";

/** Render options that set FEATURE_KO_IMAGERY the way the server pages do:
 *  `render(ui, withKoImagery(true))`. */
export function withKoImagery(enabled: boolean) {
  return {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <KoImageryProvider enabled={enabled}>{children}</KoImageryProvider>
    ),
  };
}

/** Render options that set both server-read design flags the way
 *  DesignFlagsProvider does. */
export function withDesignFlags({
  koImagery,
  multiFrame,
}: {
  koImagery: boolean;
  multiFrame: boolean;
}) {
  return {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <KoImageryProvider enabled={koImagery}>
        <MultiFrameProvider enabled={multiFrame}>{children}</MultiFrameProvider>
      </KoImageryProvider>
    ),
  };
}
