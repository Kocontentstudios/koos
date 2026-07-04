import { requireRole } from "@/lib/auth/require-role";
import { getAppSettings } from "@/lib/db/queries";
import { SettingsForm } from "./settings-form";

export default async function AdminSettingsPage() {
  await requireRole(["admin"]);
  const settings = await getAppSettings();
  const smtpConfigured = Boolean(
    process.env.ZOHO_SMTP_USER && process.env.ZOHO_SMTP_PASS,
  );

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

      <div className="max-w-md rounded-xl border border-[var(--border)] bg-surface-1 p-5">
        <p className="text-[13px] font-medium text-foreground">Email (SMTP)</p>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          {smtpConfigured
            ? "Configured. Credentials are managed via environment variables."
            : "Not configured. Set ZOHO_SMTP_USER / ZOHO_SMTP_PASS in the environment."}
        </p>
      </div>
    </div>
  );
}
