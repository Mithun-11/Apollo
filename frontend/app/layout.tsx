import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apollo — Song Recognition",
  description: "Recognize nearby songs from a short microphone recording and explore the signal pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
