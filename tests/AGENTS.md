# tests/ — OCR & Theme Regression Framework

## Purpose

Headless regression and accuracy testing for WFInfo's real OCR pipeline and
theme detection, run through the production code paths (no mocks/copies).

## Ownership

- `map.json` — scenario list (paths relative to it, no extensions).
- `data/` — scenario pairs: `<name>.json` (spec) + `<name>.png` (screenshot).
- Runner implementations live in `../WFInfo/Tests/` (linked into the app and
  into the headless runner); this folder holds scenario data, runner scripts and
  docs.

## Local Contracts

- Scenario spec fields (JSON): `description`, `resolution`, `scaling` (required
  int), `theme` (required), `language` (required), `parts` (required map
  index→name), `category` (`reward`|`snapit`, required), `hdr` (required bool),
  `filters` (optional list).
- Categories: `reward` → `ExtractPartBoxAutomatically` +
  `GetTextFromImage` + `GetPartName`; `snapit` → theme detection +
  `ScaleUpAndFilter` + `FindAllParts` + `GetPartName`.
- Exit codes: 0 all pass, 1 some fail/error, 2 fatal (missing files, init).
- Output: JSON report at the given path (default
  `test_results_<timestamp>.json`) plus stdout summary.
- Locales map to tesseract locale codes; only locales with tessdata on the
  WFCD libs server can run (en, ko, fr, uk, it, de, es, pt, pl, ru, zh-hans,
  zh-hant; ja/th/tr are not downloadable today).

## Work Guidance

- Add a scenario: screenshot PNG + matching JSON spec + entry in `map.json`.
- First suite run downloads market DBs and tessdata; requires network.
- Current known gap: `data/` contains only JSON specs, no PNGs — every scenario
  errors with "PNG not found" until real screenshots are added. Do not delete
  specs; add PNGs.
- Windows runner: `run_tests.bat` / `run_theme_tests.bat`. Linux runner:
  `nix develop -c dotnet run --project headless -- --test tests/map.json out.json`
  and `--theme-test` for the theme runner. Manual invocation is
  `WFInfo.exe [--test] map.json [out.json]`.

## Verification

- Keep runner semantics aligned with `../WFInfo/AGENTS.md` exit-code contract.
- After editing specs/map: run the suite on Linux (see headless/AGENTS.md) and
  confirm the report structure and exit codes.

## Child DOX Index

None.
