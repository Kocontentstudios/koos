/**
 * Copy that only makes sense with a mouse ("drag", "paste") is hidden on touch
 * screens, where the same words would describe something the user cannot do.
 * CSS, not a hook, so server and client render the same markup.
 */
export function PointerOnly({ children }: { children: React.ReactNode }) {
  return <span className="[@media(hover:none)]:hidden">{children}</span>;
}

export function TouchOnly({ children }: { children: React.ReactNode }) {
  return <span className="hidden [@media(hover:none)]:inline">{children}</span>;
}
