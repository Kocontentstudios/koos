"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "koos_sidebar_collapsed";

interface SidebarCollapseValue {
  /** Desktop-only: sidebar shrunk to an icon rail (md+). */
  collapsed: boolean;
  toggle: () => void;
  /** Mobile-only: off-canvas drawer is open. */
  mobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
}

const SidebarCollapseContext = createContext<SidebarCollapseValue | null>(null);

/**
 * Shares sidebar state between the sidebar and the main content wrapper
 * (siblings). `collapsed` is the persisted desktop icon-rail preference;
 * `mobileOpen` is the transient off-canvas drawer state for small screens.
 */
export function SidebarCollapseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hydrate after mount to avoid an SSR/client mismatch.
  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY) === "true") {
      setCollapsed(true);
    }
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <SidebarCollapseContext.Provider
      value={{
        collapsed,
        toggle,
        mobileOpen,
        openMobile: () => setMobileOpen(true),
        closeMobile: () => setMobileOpen(false),
      }}
    >
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    throw new Error(
      "useSidebarCollapse must be used within a SidebarCollapseProvider",
    );
  }
  return ctx;
}
