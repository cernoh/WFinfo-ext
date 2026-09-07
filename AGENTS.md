# WFInfo — Agent Guide (DOX root)

- DOX is highly performant AGENTS.md hierarchy installed here.
- Agent must follow DOX instructions across any edits.
- This repository is a fork (origin: `git@github.com:cernoh/WFinfo-ext.git`); the
  Windows app is WFInfo, a Warframe companion (OCR + market prices + overlay).

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable
  docs must stay understandable from the nearest applicable AGENTS.md plus every
  parent AGENTS.md above it.
- No child doc may weaken DOX. The closer a doc is to the work, the more
  specific and practical it must be.

## Read Before Editing

1. Read the root AGENTS.md (this file).
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path; read every AGENTS.md found
   along each route. Re-read the applicable chain in the current session; do not
   rely on memory.

## Purpose

WFInfo scans Warframe fissure reward screens and the prime inventory with OCR,
matches part names against market data, and displays plat/ducat values. The
Windows release is `.NET Framework 4.8` + WPF/WinForms and is Windows-only.

Since 2026 the repo also carries a **Linux-native headless core**: the
platform-neutral OCR/theme/market-data/test code (linked, not copied) builds and
runs as a .NET 9 console runner via the Nix flake in `flake.nix`. Windows UI and
Win32 surfaces are NOT portable and stay Windows-only.

The repo also carries `dashboard/`: a Deno + GOV.UK Frontend web dashboard
("Warframe Info", an independent digital service) that presents the local
WFInfo data — OCR logs, OCR test runs, and cached market prices — in a browser.

## Ownership

- `WFInfo/` — Windows desktop app AND the shared core sources (Ocr.cs, Data.cs,
  LanguageProcessing/, Services/, Settings/, Tests/). Child: `WFInfo/AGENTS.md`.
- `headless/` — Linux-native runner project + platform seams. Child: `headless/AGENTS.md`.
- `dashboard/` — Deno + GOV.UK Frontend web dashboard over local WFInfo data
  (logs, OCR runs, market DBs). Child: `dashboard/AGENTS.md`.
- `tests/` — OCR/theme regression framework docs + scenario data. Child: `tests/AGENTS.md`.
- `docs/` — GitHub Pages website (has CNAME/index.html; do not drop engineering
  docs into it), owned at root.
- `flake.nix`, `.gitignore`, README files — root-owned.

## Local Contracts

- Remote-repo workflow (origin exists): never edit `master` directly; use a
  feature branch + PR. GitHub **issues are disabled** on this remote — PRs cannot
  be issue-linked here; write a complete PR body instead and tag the PR title
  with `(#<number>)`.
- Windows app build/run: `dotnet build WFInfo.sln -c Release` (Windows + Visual
  Studio / .NET Framework 4.8 tooling). Startup object:
  `WFInfo.CustomEntrypoint.Main` — a `.json`/`--test` argument redirects to the
  headless OCR test runner; `--theme-debug <folder> [uiScale]` runs the theme
  detector over PNGs.
- Cross-platform guardrails for shared sources:
  - Path building MUST use `Path.Combine` (backslash string concat breaks Linux).
  - Do NOT add new WPF/WinForms/Win32 or `System.Windows.*` references to core
    logic files (Ocr.cs, Data.cs, LanguageProcessing, Services, Settings,
    Tests). Interfaces must not leak WinForms types.
  - Do NOT add `#if` platform forks in shared code. If a Windows-only type must
    be referenced from shared code, the headless project supplies a compile-time
    shape in `headless/Platform/` (see its AGENTS.md).
- `AGENTS.md`, READMEs and docs stay in Simplified Technical English (STE);
  keep them short and operational.

## Verification (current)

Run inside `nix develop`:

- `dotnet build headless/WFInfo.Headless.csproj` — must compile clean.
- `dotnet run --project headless -- --selfcheck` — native OCR end-to-end.
- `dotnet run --project headless -- --test tests/map.json out.json` — OCR suite.
- `dotnet run --project headless -- --theme-test <folder>` — theme runner.

Dashboard (Deno, also inside `nix develop`):

- `cd dashboard && deno fmt --check && deno check src && deno lint` — static gates.
- `cd dashboard && deno test -A src` — offline unit tests.
- `nix flake check` — format/typecheck/unit-test gates in a sandbox.
- `cd dashboard && deno task dev` — dashboard on http://localhost:8000.

The Windows build cannot be verified on Linux; keep shared-code edits
Windows-equivalent (Path.Combine semantics) and compile-check them here.

## Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents/children; refresh every
   affected Child DOX Index; delete stale notes.
3. Run existing verification relevant to the change.

## User Preferences

- Final reports in plain concise prose; evidence from real runs.
- No cheerleading; correctness first, then maintainability.

## Child DOX Index

- `WFInfo/AGENTS.md` — Windows app + shared core: architecture, entry flow,
  test-mode dispatch, portability rules.
- `headless/AGENTS.md` — Linux runner: linked-source discipline, platform seams,
  env vars, package pins.
- `dashboard/AGENTS.md` — Deno dashboard: routes, data sources, offline-gate
  rules, GOV.UK styling conventions.
- `tests/AGENTS.md` — OCR/theme regression framework: scenario contract,
  data layout, known gaps.
