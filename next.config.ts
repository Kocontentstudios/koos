import type { NextConfig } from "next";

// Allow remote logo images served from the configured R2 public/custom domain.
const r2Host = process.env.R2_PUBLIC_BASE_URL
  ? (() => {
      try {
        return new URL(process.env.R2_PUBLIC_BASE_URL as string).hostname;
      } catch {
        return null;
      }
    })()
  : null;

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "@node-rs/argon2"],
  images: {
    remotePatterns: r2Host ? [{ protocol: "https", hostname: r2Host }] : [],
  },
};

export default nextConfig;
