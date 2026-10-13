import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tutor Workspace — Mark, record, explain",
  description: "Review paper tests, record daily work and prepare evidence-based conversations.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
