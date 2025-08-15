import type { NextConfig } from "next";
import withPWA from "next-pwa";

const baseConfig: NextConfig = {
  reactStrictMode: true,
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true, // ★ ESLintエラーでビルド停止しない
  },
};

export default withPWA({
  dest: "public", // PWA の静的ファイル出力先
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development", // 開発環境では PWA を無効化
})(baseConfig);