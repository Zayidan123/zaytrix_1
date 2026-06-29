import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "preview-chat-937c3f2f-429b-4473-975a-aa03ddd4d91b.space-z.ai",
  ],
};

export default nextConfig;