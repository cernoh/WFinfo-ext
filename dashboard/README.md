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
| `/scan` | Newest OCR reward-screen scan: which part to take for the best platinum return, every priced choice, and the captured screenshot |
| `/wfmarket` | Cached prime-part prices (plat, volume, ducats) with search and sort; select a part for live 90-day statistics |

## Quick start

From the repo root inside the flake dev shell:

```bash
nix develop
cd dashboard && deno task dev
```

Then open <http://localhost:8000>. Use a different port with `PORT=8765`.

A busy port stops the start with `error: port 8000 is already in use`; the
server never picks another port on its own.

To run it without the watch mode:

```bash
nix run .#dashboard
```

To develop the dashboard and the headless backend together, run the dev stack.
It serves the dashboard with live reload and rebuilds and re-runs the
reward-screen scan after every edit under `headless/`. One Ctrl-C stops both.

```bash
nix run .#dev-all
```

The dev stack turns scan notifications off and takes extra arguments for the
scan, for example `nix run .#dev-all -- --file docs/images/window.png`.

The dev stack prints the dashboard address it chose. It takes the first free
port from 8000 up, so a service that already holds 8000 (a container, another
dev server) does not stop it. Set `PORT` to pin the port instead: a busy `PORT`
is then a start error.

## Data sources

The dashboard reads WFInfo's local application data and never writes to it:

- `<data dir>/WFInfo/debug.log` — log tail and reward-screen events.
- `<data dir>/WFInfo/ocr_runs/` — OCR suite results (written by the headless
  runner on every `--test` run: `latest.json` plus a timestamped file).
- `<data dir>/WFInfo/market_items.json` + `market_data.json` — cached market
  catalog and price sheet (downloaded by the app or the headless runner).
- `<data dir>/WFInfo/scans/` — newest OCR scan record (`latest.json`) and the
  captured screenshot (`last.png`), written by the headless scanner.

On Linux the data dir resolves to `~/.config/WFInfo` (or the XDG config home).
Set `WFINFO_DATA_DIR` to override, exactly as the headless runner does.

## Live scan

The `/scan` page shows the newest reward-screen scan: the part worth taking
for the best platinum return, every choice the OCR recognised with its
platinum price and ducats, and the screenshot the prices came from. The page
refreshes automatically while visible, so a scan triggered by the scan hotkey
appears without a reload.

Press **Scan now** on that page to start a scan from the browser. The button
runs the scan command on the machine that hosts the dashboard (it captures that
machine's screen), then reloads the result and reports how the scan ended.
Keep the Warframe reward screen visible while it runs.

Above the button, two lists pick what the scan captures:

- **Display** — the monitor to capture (`grim -o <name>`), from `wlr-randr`.
  Leave it on *Every output (automatic)* to let the scanner try each output.
- **Window** — capture one window's frame instead of a whole display
  (`grim -g "X,Y WxH"`), from the compositor's client list. A chosen window
  wins over the display. Window geometry comes from mango IPC (`mmsg get
  all-clients`); under another compositor the list stays empty and the display
  choice still works.

**Refresh lists** re-reads both lists, so a window that just opened (Warframe,
for example) appears without a page reload. The choice is resolved when the
scan starts: a window that closed in the meantime is reported, and no scan
runs.

Scans are produced by the headless scanner:

```bash
nix run .#scan
```

The default command is the flake's scan app at the repository root
(`nix run <checkout>#scan -- --no-notify`); the first press compiles the runner.
Set the environment variables below to change that. The board only reads the
scan record and screenshot; the runner writes them.

| Variable | Effect |
|---|---|
| `WFINFO_SCAN_CMD` | Shell command that runs one scan, instead of the default. |
| `WFINFO_SCAN_ROOT` | Checkout the default command builds the runner from. |
| `WFINFO_SCAN_REMOTE` | Set to `1` to accept scan requests from another host. Default: loopback only. |

The dashboard has no login. A scan is accepted only from the page itself (no
cross-site post) and, by default, only from the host that serves the page. Do
not expose the dashboard to an untrusted network with `WFINFO_SCAN_REMOTE=1`.

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
