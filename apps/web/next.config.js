/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // sql.js（.apkg 构建用 wasm SQLite）与 jszip 置于服务端外部包：
  // 避免 webpack 打包破坏 sql-wasm.wasm 的 __dirname 定位与动态 require
  experimental: {
    serverComponentsExternalPackages: ['sql.js', 'jszip'],
  },
};

module.exports = nextConfig;
