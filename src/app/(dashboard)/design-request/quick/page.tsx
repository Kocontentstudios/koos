import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getActiveBrandForMember } from "@/lib/db/queries";
import { QuickRequestForm } from "./quick-request-form";

/** Deliberately guarded by workspace membership only, never requireBrand:
 * this page exists precisely for users whose brand profile is incomplete. */
export default async function QuickDesignRequestPage() {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser || !workspace) redirect("/login");

  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-[28px] font-bold text-foreground">
          Request a Design
        </h1>
        <p className="text-[15px] text-[var(--text-secondary)]">
          Tell us what you need and we'll brief the KO design team. You can
          finish your brand profile later.
        </p>
      </header>

      <QuickRequestForm
        defaultBusinessName={brand?.name ?? ""}
        defaultDeliveryEmail={dbUser.email}
      />
    </div>
  );
}
