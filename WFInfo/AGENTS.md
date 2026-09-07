# WFInfo/ — Windows App & Shared Core

## Purpose

Windows desktop companion for Warframe (OCR reward/inventory scanning, market
prices, overlay UI) plus the platform-neutral core that the headless runner
shares: OCR pipeline (`Ocr.cs`), market data (`Data.cs`), language processors,
Tesseract service, settings model, and the embedded test harness (`Tests/`).

## Ownership

- `WFInfo.csproj` targets `net48` + WPF/WinForms; Windows-only build.
- Shared core files (must stay Linux-compilable via `headless/`):
  `Ocr.cs`, `Data.cs`, `LanguageProcessing/*.cs`, `Services/TesseractService.cs`,
  `Services/*/I*.cs` interfaces, `Settings/ApplicationSettings.cs`,
  `Settings/IReadOnlyApplicationSettings.cs`, `Tests/{TestModels,OCRTestRunner,ThemeTestRunner}.cs`.
- Windows-only surfaces: XAML + code-behind, `Main.cs`, `CustomEntrypoint.cs`,
  `Win32.cs`, `LowLevelListener.cs`, screenshot backends, `LogCapture.cs`
  (DBWIN), `Services/WindowInfo/Win32WindowInfoService.cs`.

## Local Contracts

- Entry: `CustomEntrypoint.Main()` — bootstraps Tesseract natives then either
  dispatches to headless test mode or calls `App.Main()` (WPF).
- Test dispatch: any first arg that is `--test`/`--map` or ends in `.json` →
  `TestProgram.RunTests`; `--theme-debug <folder> [uiScale]` →
  `ThemeTestRunner.Run`.
- Exit codes: 0 all pass, 1 partial fail, 2 fatal.
- Portability: shared core files must compile on net9.0/Linux. Rules:
  - `Path.Combine` for all path building (no `+ @"\..."`).
  - No WPF/WinForms/Win32 APIs in shared files. Interface members must not use
    `System.Windows.Forms.*`/`System.Windows.*` types.
  - No `#if` platform splits — the headless project satisfies Windows-only type
    references with compile-time shapes (see `../headless/AGENTS.md`).
- When adding logic to shared files that Windows-only code calls, keep both
  builds green; verify Linux side with the flake.

## Work Guidance

- OCR test methods used headlessly already exist: `OCR.InitForTest`,
  `OCR.ProcessRewardScreenForTest`, `OCR.ProcessSnapItForTest`, `OCR.InitThemeTest`,
  `Data.Update()`/`ReloadItems()`/`GetPartName`.
- Windows app data lives under `%APPDATA%\WFInfo`; on Linux the same classes
  resolve to the XDG config dir (`~/.config/WFInfo`) — do not hard-code the
  Windows path into shared logic.

## Verification

- Windows: build + test on Windows (not available on Linux hosts).
- Linux: shared files are compile-verified by
  `nix develop -c dotnet build headless/WFInfo.Headless.csproj` and exercised by
  the self-check/OCR suite (see `../headless/AGENTS.md`).

## Child DOX Index

- `../headless/AGENTS.md` — links and exercises the shared core on Linux.
- `../tests/AGENTS.md` — scenario data and runner behavior contract.
