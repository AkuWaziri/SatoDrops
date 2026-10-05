"use client";

import { useEffect, useRef, useState } from "react";

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
  const widgetRef = useRef<string | null>(null);\n  const [error, setError] = useState(false);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;

    const render = () => {
      if (!window.turnstile || !containerRef.current || widgetRef.current) return;

      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        theme: "light",
        size: "normal",
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };

    if (window.turnstile) {
      render();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );

    if (existing) {
      existing.addEventListener("load", render);
      return () => existing.removeEventListener("load", render);
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", render);
    document.head.appendChild(script);

    return () => script.removeEventListener("load", render);
  }, [onToken]);

  if (!SITE_KEY) {
    return <div className="wallet-error">Human verification is not configured.</div>;
  }

  function retry() {\n    setError(false);\n    onToken("");\n    if (window.turnstile && widgetRef.current) {\n      window.turnstile.reset(widgetRef.current);\n    } else {\n      widgetRef.current = null;\n      requestAnimationFrame(() => {\n        if (window.turnstile && containerRef.current) {\n          renderWidget();\n        }\n      });\n    }\n  }\n\n  const renderWidget = () => {\n    if (!window.turnstile || !containerRef.current || widgetRef.current) return;\n    widgetRef.current = window.turnstile.render(containerRef.current, {\n      sitekey: SITE_KEY,\n      theme: "light",\n      size: "normal",\n      callback: onToken,\n      "expired-callback": () => { setError(false); onToken(""); },\n      "error-callback": () => { setError(true); onToken(""); },\n    });\n  };\n\n  return (\n    <div>\n      <div ref={containerRef} aria-label="Human verification" />\n      {error && (\n        <button type="button" className="secondary" onClick={retry} style={{ marginTop: 12 }}>\n          Retry verification\n        </button>\n      )}\n    </div>\n  );
}
