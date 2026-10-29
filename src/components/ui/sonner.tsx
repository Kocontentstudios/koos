"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Sonner's own light rich colours fail AA on their tints (success 4.26:1,
 *  error and info 4.35:1, warning 3.07:1), so each type's text is the app's
 *  status token for it. Sonner's tints stay, and both themes clear 4.5:1. */
export const TOAST_TEXT_TOKENS = {
  success: "--status-ready-fg",
  error: "--status-error-fg",
  info: "--status-progress-fg",
  warning: "--status-pending-fg",
} as const;

const richTextVars = Object.fromEntries(
  Object.entries(TOAST_TEXT_TOKENS).map(([type, token]) => [
    `--${type}-text`,
    `var(${token})`,
  ]),
);

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          ...richTextVars,
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
