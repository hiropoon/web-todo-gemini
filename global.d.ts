// global.d.ts
declare module "next-pwa" {
  import type { NextConfig } from "next";
  const withPWA: (options?: any) => (config: NextConfig) => NextConfig;
  export default withPWA;
}
