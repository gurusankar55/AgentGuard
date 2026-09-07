import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentGuard",
  description: "AI Policy Gateway powered by GenLayer",
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
