declare module "next-pwa" {
  import type { NextConfig } from "next";
  type WithPWA = (options?: any) => (config: NextConfig) => NextConfig;
  const withPWA: WithPWA;
  export default withPWA;
}


