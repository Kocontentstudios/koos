import { Lock } from "lucide-react";
import { BookCallLink } from "./book-call-link";
import { OFFERS } from "./offers";
import { SwitchWorkspaceButton } from "./switch-workspace-button";

export interface OpenWorkspace {
  id: string;
  name: string;
}

export function AccessGate({
  workspaceId,
  email,
  openWorkspaces,
}: {
  workspaceId: string;
  email: string;
  /** Approved workspaces this person also belongs to, e.g. a client's. */
  openWorkspaces: OpenWorkspace[];
}) {
  return (
    <main className="px-5 pt-7 pb-6 sm:px-8 sm:pt-9 xl:px-16 xl:pt-10 xl:flex xl:min-h-[calc(100vh-92px)] xl:flex-col">
      <div className="mx-auto w-full max-w-[1640px] xl:flex xl:flex-1 xl:flex-col">
        <section className="mb-6 sm:mb-8">
          <p className="mb-3.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:mb-4 sm:text-sm">
            <Lock aria-hidden="true" className="size-3.5 sm:size-[18px]" />
            Account access · Pending approval
          </p>
          <h1 className="mb-3 font-display text-[28px] font-bold leading-[34px] tracking-[-0.4px] sm:text-4xl sm:leading-[44px] xl:text-[42px] xl:leading-[52px] xl:tracking-[-0.7px]">
            Everything your brand needs, in one workspace.
          </h1>
          <p className="max-w-[1350px] text-sm leading-[22px] text-[var(--text-secondary)] sm:text-lg sm:leading-[28px] xl:text-xl xl:leading-[30px]">
            Explore what KO OS offers. Book a call so we can understand your
            needs and create a custom package for you.
          </p>
          <p className="mt-3 text-[13px] text-[var(--text-secondary)]">
            Signed in as {email}
          </p>
        </section>

        <section
          aria-label="What KO OS offers"
          className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-5 xl:flex-1 xl:auto-rows-fr xl:grid-cols-4"
        >
          {OFFERS.map(({ title, description, icon: Icon }) => (
            <article
              key={title}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-card p-6 sm:gap-4 sm:p-7"
            >
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-[12px] bg-[var(--accent-glow)] text-primary sm:size-12 [:root[data-theme=light]_&]:text-[var(--primary-active)]"
              >
                <Icon className="size-6 sm:size-[26px]" />
              </span>
              <h2 className="font-display text-xl font-bold leading-7 sm:text-2xl sm:leading-8">
                {title}
              </h2>
              <p className="text-sm leading-[22px] text-[var(--text-secondary)] sm:text-lg sm:leading-7">
                {description}
              </p>
            </article>
          ))}
        </section>

        {openWorkspaces.length > 0 && (
          <section
            aria-labelledby="open-workspaces-heading"
            className="mt-6 flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-card p-6 sm:mt-7 sm:flex-row sm:items-center sm:gap-8 sm:px-8 sm:py-7"
          >
            <div className="flex-1">
              <h2
                id="open-workspaces-heading"
                className="mb-1.5 font-display text-lg font-bold leading-[26px] sm:text-2xl sm:leading-8"
              >
                You already have access elsewhere.
              </h2>
              <p className="text-sm leading-[22px] text-[var(--text-secondary)] sm:text-lg sm:leading-7">
                This workspace is waiting for approval, but you can keep working
                in the ones you were invited to.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {openWorkspaces.map((w) => (
                <SwitchWorkspaceButton
                  key={w.id}
                  workspaceId={w.id}
                  workspaceName={w.name}
                />
              ))}
            </div>
          </section>
        )}

        <section
          aria-labelledby="book-call-heading"
          className="mt-6 flex flex-col items-stretch gap-[18px] rounded-2xl border border-[var(--border)] bg-card p-6 sm:mt-7 sm:flex-row sm:items-center sm:gap-8 sm:px-8 sm:py-7"
        >
          <div className="flex-1">
            <h2
              id="book-call-heading"
              className="mb-2 font-display text-lg font-bold leading-[26px] sm:text-2xl sm:leading-8"
            >
              Let’s build something around your brand.
            </h2>
            <p className="text-sm leading-[22px] text-[var(--text-secondary)] sm:text-lg sm:leading-7">
              Meet with us. We will discuss your needs, pricing, and the next
              step.
            </p>
          </div>
          <BookCallLink workspaceId={workspaceId} />
        </section>

        <p className="mt-[18px] text-xs leading-[18px] text-[var(--text-secondary)] sm:mt-5 sm:text-center sm:text-base sm:leading-6">
          Booking a call does not unlock your account. Access is enabled after
          payment confirmation and approval.
        </p>
      </div>
    </main>
  );
}
