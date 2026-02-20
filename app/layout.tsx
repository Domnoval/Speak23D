import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speak23D — 3D Printable House Numbers",
  description: "Generate 3D printable backlit house numbers and names. Voice or text input → downloadable STL/3MF files for your 3D printer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-zinc-950 text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
