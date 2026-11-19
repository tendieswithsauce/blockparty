import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
const supabaseWs = supabase.replace(/^http/, "ws");

// Content-Security-Policy. Next's own inline bootstrapping scripts need
// 'unsafe-inline' (no nonces here); dev mode also needs 'unsafe-eval'.
// Stripe.js loads from js.stripe.com and shows its card fields and 3D Secure
// in frames from Stripe's domains.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase} https://images.unsplash.com https://*.stripe.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabaseWs} https://api.stripe.com https://*.stripe.com${isDev ? " ws: http://localhost:*" : ""}`,
  "frame-src https://js.stripe.com https://hooks.stripe.com https://*.stripe.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com https://*.supabase.co https://*.stripe.com",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Geolocation only for the handoff GPS record, on our own pages.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self \"https://js.stripe.com\")" },
];

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
