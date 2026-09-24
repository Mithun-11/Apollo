import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted so the classroom demo never depends on an internet connection.
const display = localFont({
  src: [
    { path: "./fonts/ShipporiMinchoB1-500.woff2", weight: "500" },
    { path: "./fonts/ShipporiMinchoB1-700.woff2", weight: "700" },
    { path: "./fonts/ShipporiMinchoB1-800.woff2", weight: "800" },
  ],
  variable: "--font-display",
  display: "swap",
});

// A handful of kanji (音の星空結び時間声旋律速度聴く) for the film-credit lines.
const displayJapanese = localFont({
  src: [{ path: "./fonts/ShipporiMinchoB1-jp-700.woff2", weight: "700" }],
  variable: "--font-display-jp",
  display: "swap",
});

const text = localFont({
  src: [
    { path: "./fonts/ZenKakuGothicNew-400.woff2", weight: "400" },
    { path: "./fonts/ZenKakuGothicNew-500.woff2", weight: "500" },
    { path: "./fonts/ZenKakuGothicNew-700.woff2", weight: "700" },
  ],
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Apollo",
  description: "Recognize a song from a few seconds of sound, then watch the signal processing that found it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${displayJapanese.variable} ${text.variable}`}>
      <body>{children}</body>
    </html>
  );
}
