# Warframe Info dashboard

A small Deno web server that opens in your browser and shows what WFInfo is
doing, styled with [GOV.UK Frontend](https://frontend.design-system.service.gov.uk/).
Warframe Info is an independent digital service: it is not affiliated with
Digital Extremes, WFCD, or warframe.market.

## Pages

| Page | What it shows |
|---|---|
| `/logs` | Live tail of `debug.log` (newest first, filter box, auto-refresh) |
| `/recent` | Recently seen prime parts: reward screens parsed from `debug.log` and OCR test-suite results from `ocr_runs/` |
| `/wfmarket` | Cached prime-part prices (plat, volume, ducats) with search and sort; select a part for live 90-day statistics |

## Quick start

From the repo root inside the flake dev shell:

```bash
nix develop
cd dashboard && deno task dev
```

Then open <http://localhost:8000>. Use a different port with `PORT=8765`.

To run it without the watch mode:

```bash
nix run .#dashboard
```

## Data sources

The dashboard reads WFInfo's local application data and never writes to it:

- `<data dir>/WFInfo/debug.log` — log tail and reward-screen events.
- `<data dir>/WFInfo/ocr_runs/` — OCR suite results (written by the headless
  runner on every `--test` run: `latest.json` plus a timestamped file).
- `<data dir>/WFInfo/market_items.json` + `market_data.json` — cached market
  catalog and price sheet (downloaded by the app or the headless runner).

On Linux the data dir resolves to `~/.config/WFInfo` (or the XDG config home).
Set `WFINFO_DATA_DIR` to override, exactly as the headless runner does.

## Checks

```bash
deno fmt --check && deno check src && deno lint   # static gates
deno test -A src                                   # offline unit tests
nix flake check                                    # all gates in a sandbox
```

## GOV.UK assets

The GOV.UK stylesheet, fonts, and icons are mirrored on demand from unpkg into
`~/.cache/wfinfo-dashboard/govuk-6.5.0` (first page load needs network). For
offline use, point `WFINFO_GOVUK_DIR` at an unpacked `govuk-frontend` dist.

## Layout

- `src/main.ts` — server and routing.
- `src/lib/` — data parsing, GOV.UK asset mirror, live statistics, templates.
- `src/static/` — bespoke stylesheet, page script, and the logo asset.
