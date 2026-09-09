import { requireRole } from "@/lib/auth/require-role";
import { getAppSettings } from "@/lib/db/queries";
import { EmailHealthPanel } from "./email-health-panel";
import { SettingsForm } from "./settings-form";

export default async function AdminSettingsPage() {
  await requireRole(["admin"]);
  const settings = await getAppSettings();

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Settings
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          System configuration.
        </p>
      </header>

      <SettingsForm initialDesignTeamEmail={settings?.designTeamEmail ?? ""} />

      <EmailHealthPanel />
    </div>
  );
}
