import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The scoring engine is a workspace package that ships raw TypeScript rather
  // than a build step, so Next has to compile it alongside the app. This keeps
  // one copy of the scoring logic: the same code the parity harness verifies
  // against 18 seasons of published results is the code that runs in the app.
  transpilePackages: ["@fwm/results-engine"],
};

export default nextConfig;
