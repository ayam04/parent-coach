import type { NextConfig } from "next";

/**
 * Conservative security headers, applied to every route.
 *
 * The CSP keeps the app working as Next.js renders it: Next injects inline
 * bootstrap/streaming scripts and inline style attributes, so 'unsafe-inline'
 * is required for scripts and styles. That weakens the script-src protection
 * (a strict nonce-based CSP would need middleware and a dynamic render); the
 * remaining directives still block framing, object/plugin embedding and
 * cross-origin data exfiltration.
 */
const isDevelopment = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js streams RSC payloads through inline scripts; dev also needs eval.
  isDevelopment ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The UI only talks to this origin; dev additionally needs the HMR socket.
  isDevelopment ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  /* config options here */
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
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
