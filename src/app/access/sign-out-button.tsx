"use client";

import { LogOut } from "lucide-react";
import { LogoutForm } from "@/components/layout/logout-form";
import { Button } from "@/components/ui/button";

/* The gate is the only page a pending account can reach, so signing out is
   the one way to try a different account. Labelled at every width: an
   icon alone is easy to miss when it is the only way out. */
export function SignOutButton() {
  return (
    <LogoutForm>
      {(pending) => (
        <Button
          type="submit"
          variant="ghost"
          size="lg"
          loading={pending}
          loadingText="Signing out…"
          className="h-9 px-2 sm:px-2.5 xl:h-11 xl:px-4 xl:text-[15px] xl:[&_svg:not([class*='size-'])]:size-5"
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      )}
    </LogoutForm>
  );
}
