/**
 * Stand-in for the `server-only` package when running tests.
 *
 * `server-only` exists to make a build fail if server code is ever pulled into a
 * client bundle. It does that by exporting a module that throws unless Next has
 * resolved it under React's `react-server` condition — which Vitest does not set,
 * so importing the real package from a test throws before a single assertion runs.
 *
 * Aliasing it to this empty module lets tests import server modules directly. The
 * guarantee itself is unaffected: it is enforced at build time by `next build`,
 * which still resolves the real package.
 */
export {}
