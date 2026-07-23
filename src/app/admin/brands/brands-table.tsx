"use client";

import Link from "next/link";
import { useState } from "react";

export interface BrandListRow {
  id: string;
  name: string;
  ownerEmail: string;
  workspaceName: string;
  status: string;
  completionPercentage: number;
  ticketCount: number;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BrandsTable({ brands }: { brands: BrandListRow[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? brands.filter(
        (b) =>
          b.name.toLowerCase().includes(needle) ||
          b.ownerEmail.toLowerCase().includes(needle),
      )
    : brands;

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        aria-label="Search brands"
        placeholder="Search by brand or owner email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
      />

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-1 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Brand</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Tickets</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((b) => (
              <tr
                key={b.id}
                className="border-t border-[var(--border)] text-foreground"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/brands/${b.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {b.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {b.ownerEmail}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {b.workspaceName}
                </td>
                <td className="px-4 py-3">
                  <span className="capitalize text-[var(--text-secondary)]">
                    {b.status}
                  </span>{" "}
                  <span className="text-[var(--text-muted)]">
                    ({b.completionPercentage}%)
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {b.ticketCount}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {formatDate(b.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
            No brands match that search.
          </p>
        )}
      </div>
    </div>
  );
}
