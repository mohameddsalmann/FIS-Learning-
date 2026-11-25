import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/engineering/docs/*": ["./docs/*.md"] },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), on-device-speech-recognition=(self)" },
      ],
    }];
  },
};

export default config;
