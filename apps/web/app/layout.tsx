import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/providers";

export const metadata: Metadata = {
  title: "Lexlingo",
  description: "Lexlingo web app",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
