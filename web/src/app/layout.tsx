import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Block from "@/components/block";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="bg-zinc-50 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
        <Providers>
          <div className="flex min-h-screen flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
