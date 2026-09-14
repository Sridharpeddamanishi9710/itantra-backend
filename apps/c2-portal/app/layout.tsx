import type { Metadata } from "next";
import "./globals.css";
// @ts-ignore
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "iTantra C2 Portal",
  description: "Tactical Stream & Monitoring Command Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950 text-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}