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
          /* richColors draws each type in sonner's own palette; its light
             error text (#e60000 on #fff0f0) is 4.35:1. Each type takes the
             popover ground and the status foreground the token gate holds to
             4.5:1 on every surface instead. */
          "--success-bg": "var(--popover)",
          "--success-text": "var(--status-ready-fg)",
          "--success-border": "var(--status-ready-fg)",
          "--info-bg": "var(--popover)",
          "--info-text": "var(--status-progress-fg)",
          "--info-border": "var(--status-progress-fg)",
          "--warning-bg": "var(--popover)",
          "--warning-text": "var(--status-pending-fg)",
          "--warning-border": "var(--status-pending-fg)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--status-error-fg)",
          "--error-border": "var(--status-error-fg)",
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
