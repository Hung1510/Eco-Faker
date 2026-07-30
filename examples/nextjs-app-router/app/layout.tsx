import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fake Shopify Backend — Next.js + eco-faker",
  description: "Products and orders rendered from a relationally-consistent generated dataset.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
