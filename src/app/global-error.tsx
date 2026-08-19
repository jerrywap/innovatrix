"use client";

/**
 * Catches failures in the root layout itself, so it must render its own
 * <html> and <body> and must not rely on any app-level provider.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#ededed",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            CoSetup is temporarily unavailable
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, opacity: 0.65 }}>
            We’ve been notified. Please try again in a moment.
          </p>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 12, fontFamily: "monospace", opacity: 0.45 }}>
              {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 28,
              padding: "12px 24px",
              borderRadius: 999,
              border: 0,
              background: "#ededed",
              color: "#0a0a0a",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
