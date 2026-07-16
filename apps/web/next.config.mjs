/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sandbox/shared'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
