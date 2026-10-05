"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "invisible";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

type Props = {
  onToken: (token: string) => void;
};

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function FcfsTurnstile({ onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [error, setError] = useState(false);

  const renderWidget = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetRef.current) return;
    widgetRef.current = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      theme: "light",
      size: "normal",
      callback: onToken,
      "expired-callback": () => {
        setError(false);
        onToken("");
      },
      "error-callback": () => {
        setError(true);
        onToken("");
      },
    });
  }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;

    if (window.turnstile) {
      renderWidget();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );

    if (existing) {
      existing.addEventListener("load", renderWidget);
      return () => existing.removeEventListener("load", renderWidget);
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", renderWidget);
    document.head.appendChild(script);

    return () => script.removeEventListener("load", renderWidget);
  }, [renderWidget]);

  if (!SITE_KEY) {
    return <div className="wallet-error">Human verification is not configured.</div>;
  }

  function retry() {
    setError(false);
    onToken("");
    if (window.turnstile && widgetRef.current) {
      window.turnstile.reset(widgetRef.current);
      return;
    }
    widgetRef.current = null;
    requestAnimationFrame(renderWidget);
  }

  return (
    <div>
      <div ref={containerRef} aria-label="Human verification" />
      {error && (
        <button type="button" className="secondary" onClick={retry} style={{ marginTop: 12 }}>
          Retry verification
        </button>
      )}
    </div>
  );
}
