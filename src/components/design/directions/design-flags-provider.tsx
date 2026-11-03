import { koImageryEnabled } from "@/lib/design/ko-imagery-flag";
import { multiFrameEnabled } from "@/lib/design/multi-frame-flag";
import { KoImageryProvider } from "./ko-imagery-context";
import { MultiFrameProvider } from "./multi-frame-context";

/**
 * The server-read flags the image-choice dialog depends on, handed down in
 * one place. Every page that can open the dialog wraps itself in this, so a
 * new flag reaches all of them at once instead of the page that remembered.
 * Server component: the flags are env reads, never shipped to the browser.
 */
export function DesignFlagsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <KoImageryProvider enabled={koImageryEnabled()}>
      <MultiFrameProvider enabled={multiFrameEnabled()}>
        {children}
      </MultiFrameProvider>
    </KoImageryProvider>
  );
}
