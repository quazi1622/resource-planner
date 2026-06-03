import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.0.106'],
  outputFileTracingIncludes: {
    '/api/backend/[...path]': [
      './server.js',
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-src 'self' https://www.google.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
