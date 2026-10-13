import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyTalent Education — Mark, record, explain",
  description: "Review paper tests, record daily work and prepare evidence-based conversations.",
  icons: {
    icon: "/mytalent-logo.png",
    shortcut: "/mytalent-logo.png",
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
