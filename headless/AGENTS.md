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
  <folder> [uiScale]` (`--theme-debug` accepted), `--selfcheck`.
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
- Self-check renders "Volt Prime Blueprint" and OCRs it — the fastest end-to-end
  proof that natives, tessdata, and imaging work on the current machine.
- `tests/data/*.png` fixtures are currently absent from the repo; until they
  exist the OCR suite reports "PNG not found" errors for every scenario while
  still exercising DB update + engine init (this is the pre-existing repo state,
  not a regression).

## Verification

- `nix develop -c dotnet build headless/WFInfo.Headless.csproj` — clean build.
- `nix develop -c dotnet run --project headless -- --selfcheck` — PASS expected.
- `nix develop -c dotnet run --project headless -- --test tests/map.json out.json`
  — runs the suite; exit 0/1/2 per the runner contract.

## Child DOX Index

None (no durable sub-boundaries inside this folder).
