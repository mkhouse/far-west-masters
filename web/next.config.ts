import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The scoring engine is a workspace package that ships raw TypeScript rather
  // than a build step, so Next has to compile it alongside the app. This keeps
  // one copy of the scoring logic: the same code the parity harness verifies
  // against 18 seasons of published results is the code that runs in the app.
  transpilePackages: ["@fwm/results-engine"],

  async redirects() {
    return [
      // "/messaging" is what people type. Cheaper to accept it than to correct
      // everyone, and it covers deeper paths too.
      {
        source: "/messaging",
        destination: "/messages",
        permanent: false,
      },
      {
        source: "/messaging/:path*",
        destination: "/messages/:path*",
        permanent: false,
      },

      // For now the app IS the messaging console, so the root should go there
      // rather than to a placeholder. Anyone not signed in is passed on to
      // sign-in by the proxy, which is the right landing place today.
      //
      // DELIBERATELY TEMPORARY (307, not 308). When the public results browser
      // lands, "/" becomes a public page and this goes away. A permanent
      // redirect would be cached by every browser that ever followed it, and
      // undoing that is not something you can do from the server.
      //
      // `missing` keeps this out of the way of sign-in: a magic-link code often
      // arrives at "/" (Supabase redirects to the project Site URL when the
      // requested callback is not allow-listed), and redirecting it onward buries
      // the code somewhere that cannot use it. The proxy also rescues this case;
      // both exist because a broken sign-in is not a failure worth being clever
      // about.
      {
        source: "/",
        destination: "/messages",
        permanent: false,
        missing: [{ type: "query", key: "code" }],
      },
    ];
  },
};

export default nextConfig;
