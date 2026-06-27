/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/kakusho/:path*',
        destination: 'https://worrying-drucy-faucetdrops-aab2b1e1.koyeb.app/:path*',
      },
    ];
  },
    eslint: {
    ignoreDuringBuilds: true,
  },


  webpack: (config) => {
    config.optimization.minimizer.forEach((minimizer) => {
      if (minimizer.constructor?.name === 'TerserPlugin') {
        minimizer.options.terserOptions = {
          ...minimizer.options.terserOptions,
          module: true,
        };
      }
    });
    return config;
  },
};

module.exports = nextConfig;