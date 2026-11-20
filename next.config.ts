import type { NextConfig } from 'next';

// Eksport statyczny: `npm run build` tworzy katalog `out/` ze zwykłymi plikami
// HTML/CSS/JS, które wgrywa się przez FTP na klasyczny hosting WWW OVH (bez Node.js).
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
