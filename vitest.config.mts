/**
 * Test configuration for the whole repository.
 *
 * One runner covering both workspaces, so `npm test` at the root is the single
 * command anybody needs to know. Each workspace is a separate Vitest project rather
 * than one flat run, because they have genuinely different needs: the web app needs
 * path aliases and a stub for `server-only`, the results engine needs neither.
 *
 * WHAT BELONGS HERE (tier 1): pure logic with no database and no browser — the
 * consent gate, SMS segment counting, phone normalisation, scoring. These are the
 * rules that are expensive to get wrong and cheap to test.
 *
 * WHAT DOES NOT, yet:
 *   * Server actions that talk to Supabase. Those need a real Postgres
 *     (`supabase start`) and belong in a separate integration project.
 *   * Anything rendering a page. Playwright over the opt-in form is the right tool,
 *     and is worth adding once the app stops changing shape weekly.
 */
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  test: {
    // The results engine has no tests yet — see task #58, tier 2. Without this the
    // whole run fails on an empty project rather than reporting the web results.
    passWithNoTests: true,

    projects: [
      {
        test: {
          name: 'web',
          root: './web',
          // Node, not jsdom: everything under test here is logic, not components.
          // Add a jsdom project alongside this one if component tests ever arrive,
          // rather than making every test pay for a fake DOM.
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
        resolve: {
          alias: {
            // Mirrors the `@/*` path in web/tsconfig.json, so tests import modules
            // by the same specifier the application uses.
            '@': resolve('./web/src'),
            // See test/stubs/server-only.ts for why this alias exists.
            'server-only': resolve('./test/stubs/server-only.ts'),
          },
        },
      },
      {
        test: {
          name: 'results-engine',
          root: './results-engine',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
})
