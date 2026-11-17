// scripts/import-cra-charities.mjs
// Loads the CRA "List of charities" identification file into
// public.cra_charities, which charity applications are matched against.
//
// Once a year, when the CRA publishes a new list:
//   1. Download "Identification" (ident_YYYY_updated.csv) from the latest
//      "List of charities" dataset on open.canada.ca.
//   2. node --env-file=.env.local scripts/import-cra-charities.mjs path/to/ident_YYYY_updated.csv YYYY
//
// Charities missing from the new list are removed from the table (they can
// still apply; an admin checks them by hand). Needs NEXT_PUBLIC_SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [file, yearArg] = process.argv.slice(2)
const year = Number(yearArg)
if (!file || !Number.isInteger(year)) {
  console.error('Usage: node --env-file=.env.local scripts/import-cra-charities.mjs <ident.csv> <year>')
  process.exit(1)
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

/** Minimal CSV parser: quoted fields, commas and "" inside quotes, CRLF. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const [header, ...lines] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''))
const col = (name) => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`Column "${name}" not found; got: ${header.join(', ')}`)
  return i
}
const idx = {
  bn: col('BN'),
  legal: col('Legal Name'),
  account: col('Account Name'),
  designation: col('Designation'),
  city: col('City'),
  province: col('Province'),
}

const records = new Map()
for (const r of lines) {
  const bn = (r[idx.bn] ?? '').trim().toUpperCase()
  if (!/^[0-9]{9}RR[0-9]{4}$/.test(bn)) continue
  records.set(bn, {
    bn,
    legal_name: (r[idx.legal] ?? '').trim() || bn,
    account_name: (r[idx.account] ?? '').trim() || null,
    designation: (r[idx.designation] ?? '').trim() || null,
    city: (r[idx.city] ?? '').trim() || null,
    province: (r[idx.province] ?? '').trim() || null,
    list_year: year,
  })
}
console.log(`Parsed ${records.size} charities from ${lines.length} rows`)

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const all = [...records.values()]
const BATCH = 1000
for (let i = 0; i < all.length; i += BATCH) {
  const { error } = await supabase.from('cra_charities').upsert(all.slice(i, i + BATCH), { onConflict: 'bn' })
  if (error) {
    console.error(`Batch at ${i} failed:`, error.message)
    process.exit(1)
  }
  if ((i / BATCH) % 10 === 0) console.log(`  ${Math.min(i + BATCH, all.length)} / ${all.length}`)
}

// Drop charities that weren't on this year's list.
const { error: pruneError, count } = await supabase
  .from('cra_charities')
  .delete({ count: 'exact' })
  .lt('list_year', year)
if (pruneError) console.error('Removing old entries failed:', pruneError.message)
else console.log(`Removed ${count ?? 0} charities not on the ${year} list`)
console.log('Done')
