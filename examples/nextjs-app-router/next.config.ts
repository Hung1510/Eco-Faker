import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // eco-faker's default entry point re-exports optional integration
  // adapters (GraphQL, tRPC, MSW, Apollo, React Query) that depend on
  // peer packages you may not have installed. Left un-externalized,
  // Turbopack/webpack try to statically resolve those imports at build
  // time and fail the whole build even though `generate()` never
  // executes that code path. Treating the package as server-external
  // makes Next `require()` it at runtime instead of bundling it.
  serverExternalPackages: ["eco-faker"],
};

export default nextConfig;
