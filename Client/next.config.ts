import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  distDir: 'out', // Ordnername für den Build
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    const serverOrigin = process.env.SERVER_ORIGIN ?? 'http://localhost:5000';
    const janusHttpOrigin = process.env.JANUS_HTTP_ORIGIN ?? 'http://localhost:8088';
    const janusWsOrigin = process.env.JANUS_WS_ORIGIN ?? 'http://localhost:8188';

    return [
      {
        source: '/api/:path*',
        destination: `${serverOrigin}/api/:path*`, // Proxy API-Anfragen an den .NET Webservice
      },
      {
        source: '/hubs/:path*',
        destination: `${serverOrigin}/hubs/:path*`, // Proxy WebSocket/SingalR
      },
      {
        source: '/janus/:path*',
        destination: `${janusHttpOrigin}/janus/:path*`,
      },
      {
        source: '/janus-ws/:path*',
        destination: `${janusWsOrigin}/janus/:path*`,
      },
    ];
  }
};

export default nextConfig;
