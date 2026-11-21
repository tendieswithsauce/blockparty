import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { InstallPromptListener } from "@/lib/install-prompt";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Blockparty — Your Neighborhood Marketplace",
    template: "%s · Blockparty",
  },
  description:
    "Bid, buy and sell safely with neighbors. Pay only when you accept the item, and meet at safe public spots.",
  // iPhone "Add to Home Screen": open in its own window, like the Android app.
  appleWebApp: {
    capable: true,
    title: "Blockparty",
    statusBarStyle: "default",
  },
};

// Phones: fill the screen edge to edge (the bottom tab bar pads for the home indicator).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF8F5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Catches Chrome's install prompt for the "Install Blockparty" buttons. */}
        <InstallPromptListener />
        {/* Tester feedback button: dev site and local development only. */}
        <Suspense fallback={null}>
          <FeedbackWidget />
        </Suspense>
      </body>
    </html>
  );
}
