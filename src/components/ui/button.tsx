import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ButtonControl, type ButtonControlProps } from "./button-control";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[10px] border border-transparent bg-clip-padding text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:focus-outline disabled:pointer-events-none data-loading:cursor-progress aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary-fill text-primary-foreground hover:bg-primary-fill-hover active:bg-primary-fill-active disabled:bg-primary-disabled disabled:text-primary-disabled-foreground",
        secondary:
          "bg-transparent text-foreground border border-[var(--border-accent)] hover:bg-[rgba(19,139,200,0.08)] hover:border-[rgba(19,139,200,0.6)] disabled:opacity-50",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground disabled:opacity-50",
        icon: "bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground rounded-lg disabled:opacity-50",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 disabled:opacity-50",
        destructive:
          "bg-destructive-fill text-destructive-fill-foreground hover:bg-destructive-fill-hover active:bg-destructive-fill-hover disabled:opacity-50",
        link: "text-primary-text underline-offset-4 hover:underline disabled:opacity-50",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = Omit<ButtonControlProps, "loading"> &
  VariantProps<typeof buttonVariants> & {
    /** When true, shows a spinner, sets aria-busy and aria-disabled, and
     * swallows clicks. The button keeps its resting fill and keyboard focus:
     * loading means working, not disabled. */
    loading?: boolean;
    /** Optional label to show while `loading` (e.g. "Saving…"). Falls back to children. */
    loadingText?: React.ReactNode;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}: ButtonProps) {
  /* No function is created here: button.tsx renders from Server Components
     (brand/page.tsx), and the click guard lives in ButtonControl. */
  return (
    <ButtonControl
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      /* Announced as unavailable while it works, yet never natively disabled:
         that would drop keyboard focus to <body> and repaint the label on the
         disabled fill. ButtonControl swallows the click instead. Spread only
         when loading: an explicit undefined would override the aria-disabled
         base-ui sets for focusableWhenDisabled. */
      {...(loading ? { "aria-disabled": true } : {})}
      loading={loading}
      disabled={disabled}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? (
        <>
          <Loader2Icon className="animate-spin" aria-hidden="true" />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </ButtonControl>
  );
}

export { Button, type ButtonProps, buttonVariants };
