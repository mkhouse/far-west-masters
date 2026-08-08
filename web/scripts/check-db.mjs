#!/usr/bin/env node
/**
 * Database connectivity and schema check.
 *
 * Confirms the environment is wired up and the migrations landed: reads
 * web/.env.local, queries the database, and reports what it finds.
 *
 * Run this after setting up an environment, and as the first thing when something
 * behaves oddly — it distinguishes "credentials wrong" from "migrations not
 * applied" from "the app is broken".
 *
 * Uses plain fetch against the REST API rather than supabase-js: the client library
 * initialises a realtime connection that needs a WebSocket implementation Node 20
 * does not provide. The app itself is unaffected — this is a standalone script.
 *
 *   node web/scripts/check-db.mjs
 */

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '..', '.env.local')

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

/** Minimal .env parser — not worth a dependency for a script this small. */
async function loadEnv(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    fail(`cannot read ${path}. Copy web/.env.example to web/.env.local first.`)
  }
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = await loadEnv(envPath)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const secret = env.SUPABASE_SERVICE_ROLE_KEY
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!url) fail('NEXT_PUBLIC_SUPABASE_URL is not set in web/.env.local')
if (!secret) fail('SUPABASE_SERVICE_ROLE_KEY is not set in web/.env.local')

/** Query a table through PostgREST. Returns {rows, error}. */
async function query(table, params, key) {
  const res = await fetch(`${url}/rest/v1/${table}?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) return { rows: null, error: `${res.status} ${await res.text()}` }
  return { rows: await res.json(), error: null }
}

console.log(`Project: ${url}\n`)

// --- seasons: proves migrations 0001 and 0002 ran ---
const { rows: seasons, error: seasonsErr } = await query(
  'seasons',
  'select=year,best_n,total_races,age_groups,points_scale,active&order=year',
  secret
)
if (seasonsErr) fail(`could not read seasons — did migrations 0001/0002 run?\n  ${seasonsErr}`)

console.log(`seasons: ${seasons.length}`)
console.log(`  active: ${seasons.filter((s) => s.active).map((s) => s.year).join(', ') || 'none'}`)

// The two rule changes verified against 18 seasons of published results. If the seed
// applied correctly, both boundaries are visible in the data itself.
const scaleAt = (y) => seasons.find((s) => s.year === y)?.points_scale?.length
const groupsAt = (y) => seasons.find((s) => s.year === y)?.age_groups
console.log(`  points scale depth 2015 -> 2016: ${scaleAt(2015)} -> ${scaleAt(2016)}   (expect 15 -> 30)`)
console.log(`  age groups 2009 -> 2010:         ${groupsAt(2009)} -> ${groupsAt(2010)}   (expect ten_year -> five_year)`)

// --- cups: proves the seeded handicap rates landed ---
const { rows: cups, error: cupsErr } = await query(
  'cups',
  'select=name,handicap_rate,scoring_method',
  secret
)
if (cupsErr) fail(`could not read cups: ${cupsErr}`)

const rates = {}
for (const c of cups) (rates[c.name] ??= new Set()).add(Number(c.handicap_rate))
console.log(`\ncups: ${cups.length}`)
for (const [name, set] of Object.entries(rates)) {
  console.log(`  ${name}: rate(s) ${[...set].sort().join(', ')}`)
}

// --- migration 0003 ---
const { error: raceColErr } = await query('races', 'select=counts_toward_standings&limit=1', secret)
console.log(`\nraces.counts_toward_standings: ${raceColErr ? 'MISSING — run migration 0003' : 'present'}`)

// --- migrations 0005 and 0006: messaging ---
const { error: msgColErr } = await query(
  'messages',
  'select=category,reply_forward_to,replies_monitored,reply_notice&limit=1',
  secret
)
console.log(`\nmessage reply routing: ${msgColErr ? 'MISSING — run migration 0005' : 'present'}`)

const { rows: settings, error: settingsErr } = await query(
  'app_settings',
  'select=key,value&order=key',
  secret
)
if (settingsErr) {
  console.log('app_settings: MISSING — run migration 0006')
} else {
  console.log(`app_settings: ${settings.length}`)
  for (const s of settings) console.log(`  ${s.key} = ${s.value}`)
}

// --- the security property that matters most ---
// The publishable key ships in the browser. It must not be able to read member
// contact data. This is the check that would catch an over-permissive RLS policy
// before it leaked phone numbers.
if (publishable) {
  const { rows, error } = await query('people', 'select=phone&limit=1', publishable)
  const blocked = !!error || !Array.isArray(rows) || rows.length === 0
  console.log(`\npublishable key can read people: ${blocked ? 'NO — correct' : 'YES — SECURITY PROBLEM'}`)
  if (!blocked) process.exitCode = 1
}

console.log('\nOK')
