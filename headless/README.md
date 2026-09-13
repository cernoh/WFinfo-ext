# WFInfo.Headless — run WFInfo's OCR core natively on Linux

A .NET 9 console runner that links the real WFInfo core sources (`Ocr.cs`,
`Data.cs`, language processors, Tesseract service, settings, test harness) and
runs them on Linux without WPF/WinForms/Win32. No code forks, no mocks: the OCR
suite and theme detector execute the production pipelines.

## Quick start

```bash
nix develop
dotnet build headless/WFInfo.Headless.csproj
dotnet run --project headless -- --selfcheck          # end-to-end OCR proof
dotnet run --project headless -- --test tests/map.json out.json   # OCR suite
dotnet run --project headless -- --theme-test <folder-with-pngs>  # theme detector
```

The dev shell wires up native `libtesseract50.so`/`libleptonica-1.82.0.so`
(exact sonames the wrapper dlopens), `libgdiplus` (System.Drawing), fonts, and
`.NET` runtime libs via environment variables.

## CLI

| Command | Effect |
|---|---|
| `--test <map.json> [out.json]` (or plain `<map.json>`) | OCR regression suite |
| `--theme-test <folder> [uiScale]` (`--theme-debug` also works) | theme detection over PNGs |
| `--selfcheck` | renders sample text and OCRs it — verifies natives + tessdata + imaging |
| `--scan [options]` | reward-screen scan: capture, OCR, price, notify, record |

Every `--test` run also persists its results to the WFInfo data dir under
`ocr_runs/` (`latest.json` plus a timestamped copy; the newest 60 are kept).
The Warframe Info dashboard (`dashboard/`, run with `nix run .#dashboard`)
shows these runs on its "Recently seen" page together with reward screens
parsed from `debug.log`.

Exit codes: `0` all passed, `1` partial failures, `2` fatal errors.

## Scan — reward-screen hotkey

`--scan` reads the screen, runs the production OCR pipeline over the reward
strip, prices every recognised part, shows the best platinum choice as a desktop
notification, and writes a scan record the dashboard's "Scan" page displays.

The same scan runs from the dashboard: press **Scan now** on its Scan page
(the server runs the command below with `WFINFO_SCAN_ROOT` set to this
checkout, and `--no-notify` because the page reports the result).

```bash
nix run .#scan                     # capture every output, notify, record
nix run .#scan -- --refresh        # ignore the price-cache TTL
nix run .#scan -- --file shot.png  # price an existing screenshot (no capture)
nix run .#scan -- --json           # print the record to stdout
```

| Option | Effect |
|---|---|
| `--file <png>` | OCR this screenshot instead of capturing the screen |
| `--output <name>` | grim output (monitor) to capture; default tries each output, then the joined image |
| `--theme <name>` | force a UI theme instead of the automatic probe (`auto` restores the probe) |
| `--refresh` | ignore the local price-cache TTL for this run |
| `--ttl <hours>` | price-cache lifetime (default 6) |
| `--no-notify` | skip the desktop notification |
| `--json` | print the scan record to stdout |

Bind it to a key in the window manager (mango/dwl example, `spawn_shell`):

```
None,Print,spawn_shell,nix run /path/to/WFinfo-ext#scan
```

Each run does this:

1. Capture: `grim -o <output>` for every output (via `wlr-randr`), stopping at
   the first screen that parses, else the joined image.
2. OCR: the shared `ProcessRewardScreenForTest` pipeline plus WFInfo's
   Levenshtein name correction against `market_items.json`. A failed attempt
   retries once per UI theme, because the theme probe samples a single pixel
   column. `--theme` pins one theme and skips the retries.
3. Prices: the local cache answers instantly; missing or stale slugs are fetched
   from warframe.market's public statistics endpoint in parallel. No price is
   invented: the sheet in `market_data.json` is the offline fallback.
4. Verdict: highest platinum wins (ties: more ducats, then the later choice —
   the same rule as the Windows overlay) and is posted with `notify-send`.
5. Record: `<data dir>/WFInfo/scans/latest.json`, one timestamped copy per run
   (newest 60 kept) and the OCR'd screenshot as `scans/last.png`.

`<data dir>/WFInfo/price_cache.json` holds the platinum cache keyed by
warframe.market slug (`plat`, 48-hour `volume`, `fetchedAt`). Failed fetches are
not cached, so a network hiccup retries on the next scan instead of pinning a
stale price.

### Scan record

`scans/latest.json` (and each `scans/scan-<stamp>.json`) is the contract with
the dashboard's Scan page; `dashboard/src/lib/scan.ts` parses it.

```json
{
  "Version": 1,
  "StartedAt": "2026-09-10T14:31:02.123Z",
  "FinishedAt": "2026-09-10T14:31:03.480Z",
  "DurationMs": 1357,
  "CaptureSource": "grim",
  "CaptureTarget": "DP-2",
  "ScreenshotPath": "/home/user/.config/WFInfo/scans/last.png",
  "ScreenshotWidth": 1920,
  "ScreenshotHeight": 1080,
  "UiScaling": 1.0,
  "Theme": "STALKER",
  "ThemeWeight": 0.00398406374501992,
  "Choices": [
    {
      "Index": 1,
      "Part": "Mirage Prime Systems",
      "Slug": "mirage_prime_systems_blueprint",
      "Plat": 62.0,
      "PlatSource": "wfm",
      "PlatFetchedAt": "2026-09-10T14:31:03.201Z",
      "Volume": 41,
      "Ducats": 45,
      "Best": true
    }
  ],
  "Best": { "Index": 1, "Part": "Mirage Prime Systems", "Plat": 62.0 },
  "BestDucats": { "Index": 1, "Part": "Mirage Prime Systems", "Ducats": 45 },
  "PriceCache": { "Hits": 1, "Fetched": 2, "Failed": 0, "Entries": 137 },
  "Error": null
}
```

- Keys are always present; numbers are `null` when unknown.
- `Choices[]` is in screen order, `Index` starts at 1; `Part` is the
  OCR-corrected market name, `Slug` the warframe.market `url_name`.
- `PlatSource`: `wfm` (fetched this run), `cache`, `sheet` (offline fallback) or
  `none`.
- `Theme` is the UI theme used for the extraction: the probe result, the retry
  that matched, or the forced name. `ThemeWeight` is the probe confidence and is
  `0` when a theme is forced.
- `Best`/`BestDucats` follow the Windows overlay ranking; the same entry carries
  `"Best": true`.
- A scan with no reward screen on screen still writes a record with
  `Choices: []` (`Error: null`); a capture or database failure sets `Error`.

## Environment

- `WFINFO_NATIVE_LIBS` — directory containing `libtesseract50.so` and
  `libleptonica-1.82.0.so` (set by `nix develop`; override for other distros).
- `WFINFO_DATA_DIR` — application-data root override. tessdata and the market
  databases are stored under `<data dir>/WFInfo` (default: OS XDG config dir).

## Architecture

- `WFInfo.Headless.csproj` links shared sources from `../WFInfo` — this list is
  the core boundary.
- `Platform/` holds compile-time seams only (see `AGENTS.md` in this folder):
  stubs for Windows-only classes referenced by shared code, WPF/WinForms type
  shims, and a Bitmap→Pix bridge (lossless PNG round-trip).
- `System.Drawing.Common` is pinned to **6.0.0**: newer versions throw
  `PlatformNotSupportedException` on Linux.
- Shared core files must stay Windows-equivalent; path building uses
  `Path.Combine`.

See `AGENTS.md` in this folder and the repo root for contracts.
