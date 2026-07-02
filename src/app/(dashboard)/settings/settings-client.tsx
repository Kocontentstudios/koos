"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { changePasswordAction, updateProfileAction } from "./actions";

interface SettingsClientProps {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    hasPassword: boolean;
  };
}

type Msg = { type: "success" | "error"; text: string } | null;

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm text-foreground placeholder:text-[var(--text-muted)] focus:border-primary focus:outline-none focus:ring-1 focus:ring-[var(--accent-glow)] disabled:opacity-50";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]";

function Banner({ msg }: { msg: Msg }) {
  if (!msg) return null;
  const ok = msg.type === "success";
  return (
    <div
      aria-live="polite"
      className={`mt-4 rounded-lg px-4 py-2 text-sm ${
        ok
          ? "bg-[var(--status-ready-bg)] text-[var(--status-ready-fg)]"
          : "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]"
      }`}
    >
      {msg.text}
    </div>
  );
}

export function SettingsClient({ user }: SettingsClientProps) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<Msg>(null);

  async function saveProfile() {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      await updateProfileAction({ firstName, lastName });
      setProfileMsg({ type: "success", text: "Profile updated." });
      toast.success("Profile updated");
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Could not update profile.";
      setProfileMsg({ type: "error", text });
      toast.error(text);
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }
    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      await changePasswordAction(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({ type: "success", text: "Password updated." });
      toast.success("Password updated");
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Could not change password.";
      setPasswordMsg({ type: "error", text });
      toast.error(text);
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="font-display text-[28px] font-bold text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-[15px] text-[var(--text-secondary)]">
          Manage your account.
        </p>
      </header>

      {/* Profile */}
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 font-display text-lg font-bold text-foreground">
            Profile
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="firstName">
                First Name
              </label>
              <input
                id="firstName"
                className={inputClass}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="lastName">
                Last Name
              </label>
              <input
                id="lastName"
                className={inputClass}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className={`${inputClass} cursor-not-allowed opacity-60`}
                value={user.email}
                readOnly
              />
            </div>
          </div>
          <Banner msg={profileMsg} />
          <div className="mt-6 flex justify-end">
            <Button
              onClick={saveProfile}
              loading={savingProfile}
              loadingText="Saving…"
              disabled={!firstName.trim() && !lastName.trim()}
              size="lg"
            >
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-1 font-display text-lg font-bold text-foreground">
            {user.hasPassword ? "Change password" : "Set a password"}
          </h2>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            {user.hasPassword
              ? "Enter your current password and choose a new one."
              : "Your account uses Google sign-in. Set a password to also sign in with email."}
          </p>
          <div className="flex flex-col gap-4">
            {user.hasPassword && (
              <div>
                <label className={labelClass} htmlFor="currentPassword">
                  Current Password
                </label>
                <input
                  id="currentPassword"
                  type="password"
                  className={inputClass}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}
            <div>
              <label className={labelClass} htmlFor="newPassword">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                className={inputClass}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="confirmPassword">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                className={inputClass}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <Banner msg={passwordMsg} />
          <div className="mt-6 flex justify-end">
            <Button
              onClick={changePassword}
              loading={savingPassword}
              loadingText="Updating…"
              disabled={newPassword.length < 8}
              size="lg"
            >
              Update password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
