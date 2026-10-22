"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        data-error-boundary
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#000d20",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ maxWidth: "28rem", color: "#a7b6c7", margin: 0 }}>
          An unexpected error occurred. Please try again.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            cursor: "pointer",
            borderRadius: "10px",
            border: "none",
            background: "#1075a8",
            color: "#ffffff",
            fontWeight: 600,
            fontSize: "0.875rem",
            padding: "0.5rem 1rem",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
