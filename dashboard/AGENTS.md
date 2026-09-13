# AGENTS.md — dashboard/

## Purpose

`dashboard/` is the Warframe Info web dashboard: a Deno server styled with
GOV.UK Frontend that opens in a browser and presents WFInfo's local application
data — OCR logs, OCR test-suite results, cached market prices, and the newest
OCR reward-screen scan. It also starts a scan on demand: the "Scan now" button
on the Scan page posts to `/scan/run`, which runs the configured scan command
and reports the outcome. It is an "independent digital service" (see
`src/static/warframe-info-logo.webp`): no crown crest, no affiliation claims.

## Ownership

- `deno.json` — tasks (`start`, `dev`, `check`, `test`, `fmt`, `lint`) and
  fmt/lint exclusions (AGENTS.md, README.md, `src/static`).
- `src/main.ts` — HTTP server: routing (including `/scan`, `POST /scan/run`,
  `/api/scan`, `/api/scan/targets` and `/scan/screenshot`), env config (`PORT`,
  `WFINFO_DATA_DIR`, `WFINFO_GOVUK_DIR`, `WFINFO_CACHE_DIR`, `WFINFO_SCAN_CMD`,
  `WFINFO_SCAN_ROOT`, `WFINFO_SCAN_REMOTE`), file reading, API endpoints.
- `src/lib/scanner.ts` — one scan run at a time: spawn the configured command
  with the per-run capture arguments, kill it at the deadline, report
  status/exit code/output.
- `src/lib/targets.ts` — what a scan can capture on this host: `wlr-randr`
  displays, `mmsg get all-clients` window frames (mango IPC), `wlrctl toplevel
  list` names as a fallback, and the choice → `--output`/`--region` mapping.
- `src/lib/fsdata.ts` — app-data dir resolution (mirrors headless
  `ConfigureEnvironment`), `debug.log` tail/parse helpers, OCR suite-result
  parsing.
- `src/lib/scan.ts` — scan-record parsing: `parseScanResult` for the
  `scans/latest.json` contract, plus best-choice resolution with the contract
  tie rules (highest plat, then higher ducats, then the later index).
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
- `src/static/` — `app.css` (bespoke `wf-` classes), `dashboard.js` (polling,
  filter and the scan-button submit, progressive enhancement),
  `warframe-info-logo.webp` (brand asset).
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
- A scan run is the headless runner, never a dashboard re-implementation:
  `/scan/run` spawns `WFINFO_SCAN_CMD` (default: the flake's scan app at the
  checkout that holds `headless/`, `--no-notify`). The runner owns every file a
  scan writes (`scans/`, `price_cache.json`); the dashboard itself still writes
  nothing to the data dir.
- One scan at a time: a second request while a run is in flight is answered
  `409`, never queued — two runs would capture the screen twice and race on the
  scan record. A run past its deadline (180 s) is killed and reported as
  `timeout`.
- The Scan page offers the host's displays and windows, and the choice is
  resolved on the server: the form carries an output name (`display:DP-2`) or a
  client id (`window:7`), and `src/lib/targets.ts` turns it into `--output` or
  `--region` from the geometry the compositor reports *now*. A token the
  discovery does not know is refused (`400`), never substituted; an empty
  choice runs the command with no capture argument (the runner then tries every
  output). Target discovery is read-only, best-effort and memoised for 3 s:
  a missing `wlr-randr`/`mmsg` shortens the list and adds a note, it never
  fails the page.
- The route is a POST and is loopback-only: a cross-site post is refused, and a
  request from another host needs `WFINFO_SCAN_REMOTE=1`. The dashboard has no
  authentication; a scan captures the screen of the host that runs it.
- Progressive enhancement: `dashboard.js` posts with `Accept: application/json`
  and renders the status and the command output. Without the script the form
  still works (302 back to `/scan`, or the error page).

## Work Guidance

- Run inside the flake dev shell (`nix develop` from the repo root), then:
  - `cd dashboard && deno task dev` — watch server on http://localhost:8000
  - `deno task start` / `deno task check` / `deno task test` / `deno task fmt`
  - `nix run .#dashboard` — run the app from the flake
  - `nix run .#dev-all` — this dashboard with live reload, plus the headless
    backend rebuilt and re-run (scan) on every backend edit. Extra arguments
    go to the scan
- If port 8000 is busy, set `PORT` (e.g. `PORT=8765 deno task start`).
- GOV.UK assets download to `~/.cache/wfinfo-dashboard/govuk-6.5.0` on first
  request; set `WFINFO_GOVUK_DIR` to an unpacked dist/govuk for offline use.
- Data provenance (read-only): `debug.log` (reward screens + app activity),
  `ocr_runs/*.json` (headless `--test` persistence), `market_items.json` and
  `market_data.json` (cached market DBs), `scans/latest.json` and
  `scans/last.png` (headless `--scan` records and capture). The dashboard
  never writes to the data dir.

## Verification

- `cd dashboard && deno fmt --check && deno check src && deno lint` — clean.
- `cd dashboard && deno test -A src` — offline unit tests.
- `nix flake check` (repo root) — format/typecheck/unit-test gates in a
  sandbox.
- Live smoke: run the server, then fetch `/logs`, `/recent`, `/scan`,
  `/wfmarket`, and a `/wfmarket/<slug>` detail page in a browser.
- Scan-button smoke: open `/scan`, press "Scan now", and check the status line
  and the refreshed record — `src/lib/scan_run_test.ts` covers the route with a
  stand-in command; a real press needs the flake's scan tools on the machine.

## Child DOX Index

None.
