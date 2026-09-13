# headless/ — Linux-Native OCR/Theme Runner

## Purpose

`WFInfo.Headless` is a .NET 9 console project that runs WFInfo's real OCR/theme
core natively on Linux. It links the actual WFInfo sources — no copies, no
mocks — and supplies compile-time seams for Windows-only types so the shared
code type-checks without WPF/WinForms/Win32.

## Ownership

- `WFInfo.Headless.csproj` — which shared files are linked (see the csproj
  `Compile Include` list); keep it the single source of truth for the core
  boundary.
- `Program.cs` — CLI: `--test <map.json> [out.json]`, `--theme-test
  <folder> [uiScale]` (`--theme-debug` accepted), `--selfcheck`, `--scan
  [options]`. Every `--test` run also copies the suite results to
  `<app dir>/ocr_runs/` (`latest.json` + one timestamped file, newest 60 kept)
  for the Warframe Info dashboard; every `--scan` run writes
  `<app dir>/scans/latest.json` (same retention) plus `scans/last.png`.
- `Scan/` — the reward-screen scan feature (Linux-only, real behavior):
  `ScanRunner.cs` (capture → OCR → price → recommend → persist → notify),
  `ScreenCapture.cs` (grim + wlr-randr), `PriceCache.cs` (local platinum cache
  with on-demand warframe.market refresh), `MarketSheet.cs` (indexes
  `market_items.json`/`market_data.json`), `Notifier.cs` (notify-send),
  `ScanModels.cs`/`ScanOptions.cs`/`Shell.cs`. The record shape is a contract
  with the dashboard's Scan page: the field list is in `README.md` (Scan) and
  the reader is `dashboard/src/lib/scan.ts` — change both together.
- The scan captures one image per candidate: `--file` (an image on disk),
  `--region "X,Y WxH"` (one layout region, i.e. a window frame), `--output`
  (one monitor), else every output then the joined image. Region coordinates are
  the compositor's own client geometry, so no conversion is needed.
- `Platform/` — seams ONLY: `HeadlessMain.cs` (stub `Main`), `HeadlessServices.cs`
  (window-info service, process finder, screenshot/log-capture stubs,
  `CustomEntrypoint` helpers), `UiSurrogates.cs` (WPF window shapes),
  `PlatformTypeShims.cs` (Point/Key/MouseButton/Screen/Clipboard),
  `BitmapPixInterop.cs` (Bitmap → Pix via lossless PNG round-trip).
- `flake.nix` (repo root) owns the build environment, not this folder.

## Local Contracts

- NEVER copy or fork shared core code into `headless/`. If a shared file needs a
  platform-neutral change (e.g. `Path.Combine`), edit the shared file — the
  Windows build treats `Path.Combine` as equivalent.
- Platform seams exist ONLY to satisfy the compiler for code paths the headless
  run never executes. Members must throw `NotSupportedException` (or no-op only
  when the Windows semantics are genuinely side-effect-free, e.g. clipboard
  copy) — never silently fake core behavior.
- Adding a Windows-only API to shared code usually requires extending a seam;
  prefer removing the Windows-only dependency from the shared file instead.
- `Scan/` is real Linux feature code, not a seam — seams stay in `Platform/`.
  The scan shells out to `grim` (capture), `wlr-randr` (output list) and
  `notify-send` (verdict); the flake's dev shell and the `.#scan` app put all
  three on PATH, so never assume they exist system-wide.
- The scan reads `market_items.json`/`market_data.json` straight from disk
  instead of calling `Data.Update()`: a hotkey press must not wait for a network
  database refresh. Deeper price lookups go through `PriceCache`
  (`<app dir>/price_cache.json`): cache hits answer instantly, missing or stale
  slugs are fetched from warframe.market in parallel, failed fetches are NOT
  cached, and the sheet value is the offline fallback.
- The scan writes only `<app dir>/scans/` (records + `last.png`) and
  `<app dir>/price_cache.json`. It never writes the Windows-side files and never
  touches the ocr_runs history.
- Native library names are exact (wrapper dlopens them):
  `libtesseract50.so`, `libleptonica-1.82.0.so`; supplied by the flake's
  `tesseract-native` farm through `WFINFO_NATIVE_LIBS`.
- `System.Drawing.Common` is pinned to 6.0.0: versions ≥ 7 throw
  PlatformNotSupportedException on Linux even with `EnableUnixSupport`.
- Env vars honored by `Program.cs`:
  - `WFINFO_NATIVE_LIBS` — dir with tesseract/leptonica libs (flake sets it).
  - `WFINFO_DATA_DIR` — overrides the app-data root (tessdata + market DBs).
- Environment for OCR data dirs derives from the OS XDG config dir when
  `WFINFO_DATA_DIR` is unset — do not assume Windows `%APPDATA%`.

## Work Guidance

- Build/run inside the flake dev shell: `nix develop -c dotnet ...`.
- The dev stack (`nix run .#dev-all`) rebuilds and re-runs `--scan` after every
  edit here, next to the live-reload dashboard. It passes `--no-notify` so one
  scan per edit does not post a notification.
- Self-check renders "Volt Prime Blueprint" and OCRs it — the fastest end-to-end
  proof that natives, tessdata, and imaging work on the current machine.
- `tests/data/*.png` fixtures are currently absent from the repo; until they
  exist the OCR suite reports "PNG not found" errors for every scenario while
  still exercising DB update + engine init (this is the pre-existing repo state,
  not a regression).
- Scan runs: `nix run .#scan -- --no-notify` (flake app; builds the runner in
  the checkout, then captures every output) or, inside the dev shell,
  `dotnet run --project headless -- --scan --no-notify`. Use `--file <png>` to
  price an existing screenshot without capturing, `--output <monitor>` to pin a
  single monitor, `--region "X,Y WxH"` to pin one window frame in layout
  coordinates (what the dashboard sends for a chosen window) and `--json` to
  print the record. A reward screen is only available while the game shows one
  — verify the plumbing with `--file` and the capture path with a plain
  `--scan` on any desktop.

## Verification

- `nix develop -c dotnet build headless/WFInfo.Headless.csproj` — clean build.
- `nix develop -c dotnet run --project headless -- --selfcheck` — PASS expected.
- `nix develop -c dotnet run --project headless -- --test tests/map.json out.json`
  — runs the suite; exit 0/1/2 per the runner contract.
- `nix develop -c dotnet run --project headless -- --scan --no-notify` — must
  print a capture line, write `<app dir>/scans/latest.json` and leave a
  `Choice`-free record (exit 0) when no reward screen is on screen.
- `nix develop -c dotnet run --project headless -- --scan --no-notify --file <png>`
  — prices an existing screenshot; the second run with the same PNG must report
  cache hits instead of fetches.

## Child DOX Index

None (no durable sub-boundaries inside this folder).
