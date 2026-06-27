/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/kakusho/:path*',
        destination: 'http://127.0.0.1:8000/:path*',
      },
    ];
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