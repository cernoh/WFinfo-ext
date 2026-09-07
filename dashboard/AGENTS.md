# AGENTS.md — dashboard/

## Purpose

`dashboard/` is the Warframe Info web dashboard: a Deno server styled with GOV.UK
Frontend that opens in a browser and presents WFInfo's local application data —
OCR logs, OCR test-suite results, and cached market prices. It is an
"independent digital service" (see `src/static/warframe-info-logo.webp`): no
crown crest, no affiliation claims.

## Ownership

- `deno.json` — tasks (`start`, `dev`, `check`, `test`, `fmt`, `lint`) and
  fmt/lint exclusions (AGENTS.md, README.md, `src/static`).
- `src/main.ts` — HTTP server: routing, env config (`PORT`, `WFINFO_DATA_DIR`,
  `WFINFO_GOVUK_DIR`, `WFINFO_CACHE_DIR`), file reading, API endpoints.
- `src/lib/fsdata.ts` — app-data dir resolution (mirrors headless
  `ConfigureEnvironment`), `debug.log` tail/parse helpers, OCR suite-result
  parsing.
- `src/lib/recent.ts` — reward-screen event extraction from log lines
  ("…, detected choice: N").
- `src/lib/items.ts` — market DB parsing: `market_items.json` slug catalog,
  `market_data.json` price sheet, joins and lookups.
- `src/lib/wfm.ts` — live warframe.market statistics (public v1 endpoint),
  in-process TTL cache.
- `src/lib/charts.ts` — pure inline-SVG price chart (GOV.UK palette).
- `src/lib/govuk.ts` — mirrors govuk-frontend npm assets into a local cache
  (no npm imports at runtime).
- `src/lib/view.ts` — GOV.UK page templates and bespoke `wf-` styles wiring.
- `src/static/` — `app.css` (bespoke `wf-` classes), `dashboard.js` (polling
  + filter, progressive enhancement), `warframe-info-logo.webp` (brand asset).
- `src/lib/*_test.ts` + `src/lib/testutil.ts` — offline unit tests.

## Local Contracts

- Zero runtime dependencies: no remote or package imports anywhere in
  `src/`. Network access is confined to `src/lib/wfm.ts` (warframe.market) and
  `src/lib/govuk.ts` (unpkg asset mirror). Tests never touch the network, which
  keeps the `nix flake check` gates offline.
- Data-dir resolution must mirror the .NET side: `WFINFO_DATA_DIR` acts as the
  config root (app dir = `<dir>/WFInfo`), else XDG/`%APPDATA%` rules apply.
- Pages use GOV.UK Frontend classes only; bespoke styles are prefixed `wf-`.
- All user/file-derived text is HTML-escaped before interpolation
  (`src/lib/html.ts`).
- `dashboard.js` is a plain browser script (no build step); it is excluded
  from `deno lint` (browser globals), not from formatting.
- The logo asset is the user's brand mark; do not replace it with the GOV.UK
  crown crest.

## Work Guidance

- Run inside the flake dev shell (`nix develop` from the repo root), then:
  - `cd dashboard && deno task dev` — watch server on http://localhost:8000
  - `deno task start` / `deno task check` / `deno task test` / `deno task fmt`
  - `nix run .#dashboard` — run the app from the flake
- If port 8000 is busy, set `PORT` (e.g. `PORT=8765 deno task start`).
- GOV.UK assets download to `~/.cache/wfinfo-dashboard/govuk-6.5.0` on first
  request; set `WFINFO_GOVUK_DIR` to an unpacked dist/govuk for offline use.
- Data provenance (read-only): `debug.log` (reward screens + app activity),
  `ocr_runs/*.json` (headless `--test` persistence), `market_items.json` and
  `market_data.json` (cached market DBs). The dashboard never writes to the
  data dir.

## Verification

- `cd dashboard && deno fmt --check && deno check src && deno lint` — clean.
- `cd dashboard && deno test -A src` — offline unit tests.
- `nix flake check` (repo root) — format/typecheck/unit-test gates in a
  sandbox.
- Live smoke: run the server, then fetch `/logs`, `/recent`, `/wfmarket`, and
  a `/wfmarket/<slug>` detail page in a browser.

## Child DOX Index

None.
