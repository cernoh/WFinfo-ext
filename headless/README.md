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

Every `--test` run also persists its results to the WFInfo data dir under
`ocr_runs/` (`latest.json` plus a timestamped copy; the newest 60 are kept).
The Warframe Info dashboard (`dashboard/`, run with `nix run .#dashboard`)
shows these runs on its "Recently seen" page together with reward screens
parsed from `debug.log`.

Exit codes: `0` all passed, `1` partial failures, `2` fatal errors.

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
