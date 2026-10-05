import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SatoDrops — Tiny programmable rewards",
  description: "Tiny programmable rewards powered by Tempo.",
  icons: { icon: "/satodrops-logo.svg", shortcut: "/satodrops-logo.svg", apple: "/satodrops-logo.svg" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><link rel="preconnect" href="https://challenges.cloudflare.com" /></head><body>{children}</body></html>;
}