/**
 * GOV.UK Frontend page composition. All pages share: skip link, dark header
 * with the Warframe Info logo, header navigation (Logs / Recently seen /
 * WFMarket), phase banner ("independent digital service"), main wrapper and
 * footer. Bespoke styles live in /assets/app.css and are prefixed `wf-`.
 */

import { escapeHtml } from "./html.ts";
import type { CatalogItem } from "./items.ts";
import { wfmItemUrl } from "./items.ts";
import type { LiveStats } from "./wfm.ts";
import { priceChartSvg } from "./charts.ts";

export type NavKey = "logs" | "recent" | "wfmarket";

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Keep the decimal exactly as parsed (no trailing-zero churn). */
const fmtPlat = (n: number | null): string => n === null ? "—" : String(n);

const fmtDucats = (n: number | null): string => n === null ? "—" : String(n);

const fmtVol = (n: number | null): string => n === null ? "—" : String(n);

function tag(text: string, colour = "blue"): string {
  return `<strong class="govuk-tag govuk-tag--${colour}">${
    escapeHtml(text)
  }</strong>`;
}

function successTag(success: boolean): string {
  return success ? tag("Pass", "green") : tag("Fail", "red");
}

function timeTag(ms: number | null, fallback: string): string {
  const iso = ms === null ? "" : ` datetime="${new Date(ms).toISOString()}"`;
  return `<time class="govuk-body-s wf-muted"${iso}>${
    escapeHtml(ms === null ? fallback : fmtDate(ms))
  }</time>`;
}

/** A single recognized part with optional market join. */
export interface TokenView {
  name: string;
  slug: string | null;
  plat: number | null;
  ducats: number | null;
}

function tokenChip(t: TokenView, extraNote: string): string {
  const label = t.slug
    ? `<a class="wf-chip govuk-link" href="/wfmarket/${escapeHtml(t.slug)}">${
      escapeHtml(t.name)
    }</a>`
    : `<span class="wf-chip wf-chip--plain">${escapeHtml(t.name)}</span>`;
  const values: string[] = [];
  if (t.plat !== null) values.push(`${escapeHtml(fmtPlat(t.plat))} plat`);
  if (t.ducats !== null) {
    values.push(`${escapeHtml(fmtDucats(t.ducats))} ducats`);
  }
  const note = values.length > 0
    ? ` <span class="wf-chip__values">(${values.join(" · ")})</span>`
    : "";
  return `<li class="wf-rewards__item">${label}${note}${extraNote}</li>`;
}

/* ------------------------------------------------------------------ */
/* Template pieces                                                     */
/* ------------------------------------------------------------------ */

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "logs", href: "/logs", label: "Logs" },
  { key: "recent", href: "/recent", label: "Recently seen" },
  { key: "wfmarket", href: "/wfmarket", label: "WFMarket" },
];

function shell(title: string, active: NavKey, content: string): string {
  const navItems = NAV.map((n) =>
    `<li class="govuk-header__navigation-item${
      n.key === active ? " govuk-header__navigation-item--active" : ""
    }"><a class="govuk-header__link" href="${n.href}">${n.label}</a></li>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en" class="govuk-template">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} — Warframe Info</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b0c0c">
  <meta name="description" content="Warframe Info — an independent digital service for player resources, guides, and game data.">
  <link rel="icon" href="/govuk/assets/images/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/govuk/govuk-frontend.min.css">
  <link rel="stylesheet" href="/assets/app.css">
  <script src="/govuk/govuk-frontend.min.js" defer></script>
  <script src="/assets/dashboard.js" defer></script>
</head>
<body class="govuk-template__body">
  <script>document.body.className += ' js-enabled' + ('noModule' in HTMLScriptElement.prototype ? ' govuk-frontend-supported' : '');</script>
  <a href="#main-content" class="govuk-skip-link" data-module="govuk-skip-link">Skip to main content</a>
  <header class="govuk-header" data-module="govuk-header">
    <div class="govuk-header__container govuk-width-container">
      <div class="govuk-header__logo">
        <a href="/" class="govuk-header__link wf-header-logo-link" aria-label="Warframe Info — home">
          <img class="wf-header-logo" src="/assets/warframe-info-logo.webp"
               alt="Warframe Info — an independent digital service" width="183" height="100">
        </a>
      </div>
      <nav id="wf-navigation" class="govuk-header__navigation" aria-label="Top level navigation">
        <button type="button" class="govuk-header__menu-button govuk-js-header-toggle" aria-controls="wf-navigation-list" aria-label="Show or hide menu" hidden>Menu</button>
        <ul id="wf-navigation-list" class="govuk-header__navigation-list">
${navItems}
        </ul>
      </nav>
    </div>
  </header>
  <div class="govuk-width-container">
    <div class="govuk-phase-banner">
      <p class="govuk-phase-banner__content">
        <strong class="govuk-tag govuk-phase-banner__content__tag">Independent</strong>
        <span class="govuk-phase-banner__text">Warframe Info is an independent digital service. Not affiliated with Digital Extremes, WFCD, or warframe.market.</span>
      </p>
    </div>
  </div>
  <div class="govuk-width-container">
    <main class="govuk-main-wrapper" id="main-content" role="main">
${content}
    </main>
  </div>
  <footer class="govuk-footer">
    <div class="govuk-width-container">
      <div class="govuk-footer__meta">
        <div class="govuk-footer__meta-item govuk-footer__meta-item--grow">
          <svg class="govuk-footer__licence-logo" aria-hidden="true" focusable="false" height="17" width="41" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 483.2 195.7"><path fill="currentColor" d="M421.5 142.8V.1l-50.7 32.3v161.1h112.4v-50.7zm-122.3-9.6A47.12 47.12 0 0 1 221 97.8c0-26 21.1-47.1 47.1-47.1 16.7 0 31.4 8.7 39.7 21.8l42.7-27.2A97.63 97.63 0 0 0 268.1 0c-55.5 0-100.5 45-100.5 100.5s45 100.5 100.5 100.5c18.6 0 36.4-5.2 52-15l43.2-26.8a97.69 97.69 0 0 1-64.1-21.9z"/></svg>
          <p class="govuk-footer__licence-description">
            Warframe Info is an independent digital service for player resources, guides, and game data.
            Data shown comes from your local WFInfo application data (OCR logs and cached market databases).
            Built with <a class="govuk-footer__link" href="https://frontend.design-system.service.gov.uk/" rel="noreferrer">GOV.UK Frontend</a>.
          </p>
        </div>
        <div class="govuk-footer__meta-item">
          <a class="govuk-footer__link govuk-footer__copyright-logo" href="/">Warframe Info — independent digital service</a>
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Logs page                                                           */
/* ------------------------------------------------------------------ */

export interface LogsState {
  /** Newest first, timestamp prefix included. */
  lines: string[];
  updatedAtMs: number;
  shown: number;
  total: number;
  appDir: string;
}

export function logsPageHtml(state: LogsState): string {
  const rows = state.lines.map((l) =>
    `<li class="wf-logline">${escapeHtml(l)}</li>`
  ).join("\n");
  const content = `
<h1 class="govuk-heading-xl">Logs</h1>
<p class="govuk-body">Newest entries from <code class="wf-code">debug.log</code> in your WFInfo data directory.</p>
<p class="govuk-body-s wf-muted">Data directory: <code class="wf-code">${
    escapeHtml(state.appDir)
  }</code></p>
<div class="govuk-form-group wf-filter">
  <label class="govuk-label" for="wf-log-filter">Filter lines</label>
  <input class="govuk-input govuk-!-width-one-third" id="wf-log-filter" name="filter" type="search" autocomplete="off">
</div>
<div class="wf-log-panel" data-module="wf-logs">
  <ol class="wf-log" id="wf-log-list">
${rows}
  </ol>
  <p class="govuk-body-s wf-muted wf-log-meta" id="wf-log-meta">
    Showing ${state.shown} of ${state.total} lines · updated ${
    escapeHtml(fmtDate(state.updatedAtMs))
  }
  </p>
</div>
<p class="govuk-body-s wf-muted">This page refreshes automatically every 3 seconds while it is visible.</p>`;
  return shell("Logs", "logs", content);
}

/* ------------------------------------------------------------------ */
/* Recently seen page                                                  */
/* ------------------------------------------------------------------ */

export interface RewardView {
  ts: number | null;
  tsText: string;
  chosen: number;
  rewards: TokenView[];
}

export interface RunScenarioView {
  name: string;
  success: boolean;
  accuracy: number;
  parts: TokenView[];
  missing: string[];
  extra: string[];
  errorMessage: string | null;
}

export interface RunView {
  fileName: string;
  suite: string;
  startedMs: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  accuracy: number;
  scenarios: RunScenarioView[];
}

export interface RecentState {
  appDir: string;
  rewards: RewardView[];
  runs: RunView[];
  generatedMs: number;
  ocrRunsDirExists: boolean;
}

function rewardCard(r: RewardView, index: number): string {
  const chosenNote = (i: number): string =>
    i === r.chosen ? ` ${tag("Chosen", "blue")}` : "";
  const items = r.rewards.map((t, i) => tokenChip(t, chosenNote(i))).join("\n");
  return `<article class="wf-card">
  <div class="wf-card__head">
    <h2 class="govuk-heading-s govuk-!-margin-bottom-0">Reward screen ${
    index + 1
  }</h2>
    ${timeTag(r.ts, r.tsText || "unknown time")}
  </div>
  <ul class="govuk-list wf-rewards">${items}</ul>
</article>`;
}

function runScenarioRow(s: RunScenarioView): string {
  const parts = s.parts.length > 0
    ? `<p class="govuk-body-s wf-muted wf-!-no-margin-bottom">Recognized parts</p>
<ul class="govuk-list wf-rewards">${
      s.parts.map((t) => tokenChip(t, "")).join("\n")
    }</ul>`
    : "";
  const problems: string[] = [];
  if (s.missing.length > 0) problems.push(`missing: ${s.missing.join(", ")}`);
  if (s.extra.length > 0) problems.push(`unexpected: ${s.extra.join(", ")}`);
  const problemLine = problems.length > 0
    ? `<p class="govuk-body-s wf-err">${escapeHtml(problems.join(" · "))}</p>`
    : "";
  const errorLine = s.errorMessage
    ? `<p class="govuk-body-s wf-muted">${escapeHtml(s.errorMessage)}</p>`
    : "";
  return `<li class="wf-run-scenario">
  <div class="wf-card__head">
    <h3 class="govuk-heading-s govuk-!-margin-bottom-0">${
    escapeHtml(s.name)
  }</h3>
    ${successTag(s.success)}
    <span class="govuk-body-s wf-muted">${
    s.accuracy.toFixed(1)
  }% accuracy</span>
  </div>
  ${parts}
  ${problemLine}
  ${errorLine}
</li>`;
}

function runCard(r: RunView): string {
  const scenarios = r.scenarios.map(runScenarioRow).join("\n");
  return `<article class="wf-card">
  <div class="wf-card__head">
    <h2 class="govuk-heading-s govuk-!-margin-bottom-0">${
    escapeHtml(r.suite)
  }</h2>
    ${timeTag(r.startedMs, "unknown time")}
  </div>
  <p class="govuk-body-s wf-muted wf-!-no-margin-bottom">
    ${r.passed}/${r.total} scenarios passed (${r.accuracy.toFixed(1)}% accuracy)
    ${r.errors > 0 ? ` · ${r.errors} errored` : ""} · ${escapeHtml(r.fileName)}
  </p>
  <ul class="govuk-list wf-run-list">${scenarios}</ul>
</article>`;
}

export function recentPageHtml(state: RecentState): string {
  const rewardCards = state.rewards.length > 0
    ? state.rewards.map(rewardCard).join("\n")
    : "";
  const runCards = state.runs.length > 0
    ? state.runs.map(runCard).join("\n")
    : "";

  const content = `
<h1 class="govuk-heading-xl">Recently seen prime parts</h1>
<p class="govuk-body">Prime parts that WFInfo's OCR has reported recently — from live reward screens in
<code class="wf-code">debug.log</code> and from the latest OCR test-suite runs. Plat and ducat values come from
the cached market price sheet when the part is priced.</p>
<h2 class="govuk-heading-m">Reward screens <span class="govuk-body wf-muted" id="wf-reward-count">(${state.rewards.length})</span></h2>
<div id="wf-rewards">
${rewardCards}
</div>
<div id="wf-rewards-empty" class="govuk-inset-text"${
    state.rewards.length > 0 ? " hidden" : ""
  }>
  <p class="govuk-body wf-!-no-margin-bottom">
    No reward screens recorded yet. WFInfo logs one line per reward screen
    when it auto-processes a fissure session, for example
    <code class="wf-code">Volt Prime Systems Blueprint || Forma, detected choice: 0</code>.
    The line appears in <code class="wf-code">debug.log</code> when AutoList,
    AutoCSV, or AutoCount is enabled.
  </p>
</div>
<h2 class="govuk-heading-m">OCR test runs <span class="govuk-body wf-muted" id="wf-run-count">(${state.runs.length})</span></h2>
<div id="wf-runs">
${runCards}
</div>
<div id="wf-runs-empty" class="govuk-inset-text"${
    state.runs.length > 0 ? " hidden" : ""
  }>
  <p class="govuk-body wf-!-no-margin-bottom">
    No OCR test runs recorded. The headless runner stores every test-suite
    result under
    <code class="wf-code">${
    escapeHtml(state.appDir)
  }/ocr_runs</code> when you run
    <code class="wf-code">dotnet run --project headless -- --test &lt;map.json&gt; [out.json]</code>.
  </p>
</div>
<p class="govuk-body-s wf-muted">Updated ${
    escapeHtml(fmtDate(state.generatedMs))
  } · refreshes automatically while visible.</p>`;
  return shell("Recently seen", "recent", content);
}

/* ------------------------------------------------------------------ */
/* WFMarket pages                                                      */
/* ------------------------------------------------------------------ */

export interface MarketPageState {
  items: CatalogItem[];
  total: number;
  q: string;
  sort: SortKey;
  dir: "asc" | "desc";
  appDir: string;
  dbPresent: boolean;
}

export type SortKey = "name" | "plat" | "volume" | "ducats";

function sortHref(sort: SortKey, dir: "asc" | "desc", q: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("sort", sort);
  params.set("dir", dir);
  return `/wfmarket?${params.toString()}`;
}

function sortLink(label: string, key: SortKey, state: MarketPageState): string {
  const active = state.sort === key;
  const nextDir: "asc" | "desc" = active && state.dir === "asc"
    ? "desc"
    : "asc";
  const arrow = active ? (state.dir === "asc" ? " ↑" : " ↓") : "";
  return `<a class="govuk-link${active ? " wf-sort-active" : ""}" href="${
    sortHref(key, nextDir, state.q)
  }">${escapeHtml(label)}${arrow}</a>`;
}

export function wfmarketPageHtml(state: MarketPageState): string {
  const noDb = !state.dbPresent
    ? `<div class="govuk-inset-text">
  <p class="govuk-body wf-!-no-margin-bottom">
    No market database found at <code class="wf-code">${
      escapeHtml(state.appDir)
    }</code>.
    Run the app or the headless test runner once so it can download
    <code class="wf-code">market_items.json</code> and
    <code class="wf-code">market_data.json</code> (network needed on first run).
  </p>
</div>`
    : "";

  const rows = state.items.map((it) => {
    const plat = it.plat === null ? "—" : fmtPlat(it.plat);
    const ducats = it.ducats === null ? "—" : fmtDucats(it.ducats);
    const volume = it.volume === null ? "—" : fmtVol(it.volume);
    return `<tr class="govuk-table__row">
  <th scope="row" class="govuk-table__header wf-name-cell"><a class="govuk-link" href="/wfmarket/${
      escapeHtml(it.slug)
    }">${escapeHtml(it.fullName)}</a></th>
  <td class="govuk-table__cell wf-num">${plat}</td>
  <td class="govuk-table__cell wf-num">${volume}</td>
  <td class="govuk-table__cell wf-num">${ducats}</td>
</tr>`;
  }).join("\n");

  const qValue = state.q ? ` value="${escapeHtml(state.q)}"` : "";
  const allHref = new URLSearchParams();
  if (state.q) allHref.set("q", state.q);
  allHref.set("all", "1");

  const content = `
<h1 class="govuk-heading-xl">WFMarket</h1>
<p class="govuk-body">Prime parts and their cached prices from the WFInfo price sheet
(<code class="wf-code">market_data.json</code>) and the warframe.market item catalog
(<code class="wf-code">market_items.json</code>).</p>
${noDb}
<form class="govuk-form-group" method="get" action="/wfmarket">
  <label class="govuk-label" for="wf-item-search">Search prime parts</label>
  <div class="wf-search">
    <input class="govuk-input govuk-!-width-one-half" id="wf-item-search" name="q" type="search" autocomplete="off"${qValue}>
    <button class="govuk-button govuk-!-margin-bottom-0" data-module="govuk-button">Search</button>
    ${
    state.q ? `<a class="govuk-link wf-clear" href="/wfmarket">Clear</a>` : ""
  }
  </div>
</form>
<p class="govuk-body-s wf-muted">Showing ${state.items.length} of ${state.total} parts
${state.q ? ` for “${escapeHtml(state.q)}”` : ""}.
${
    state.total > state.items.length
      ? `<a class="govuk-link" href="/wfmarket?${allHref.toString()}">Show all ${state.total}</a>`
      : ""
  }
</p>
<table class="govuk-table wf-market-table">
  <caption class="govuk-table__caption govuk-table__caption--m">Prime parts and cached prices</caption>
  <thead class="govuk-table__head">
    <tr class="govuk-table__row">
      <th scope="col" class="govuk-table__header">${
    sortLink("Part", "name", state)
  }</th>
      <th scope="col" class="govuk-table__header wf-num">${
    sortLink("Plat", "plat", state)
  }</th>
      <th scope="col" class="govuk-table__header wf-num">${
    sortLink("Volume", "volume", state)
  }</th>
      <th scope="col" class="govuk-table__header wf-num">${
    sortLink("Ducats", "ducats", state)
  }</th>
    </tr>
  </thead>
  <tbody class="govuk-table__body">
${rows}
  </tbody>
</table>
<p class="govuk-body-s wf-muted">Plat is the cached average selling price; volume is recent trades; ducats is the
Baro Ki'Teer exchange value. Select a part for live 90-day statistics.</p>`;
  return shell("WFMarket", "wfmarket", content);
}

/* ------------------------------------------------------------------ */
/* Item detail page                                                    */
/* ------------------------------------------------------------------ */

export interface ItemDetailState {
  item: CatalogItem;
  stats: LiveStats | null;
  appDir: string;
}

export function itemPageHtml(state: ItemDetailState): string {
  const it = state.item;
  const content = `
<a class="govuk-back-link" href="/wfmarket">Back to WFMarket</a>
<h1 class="govuk-heading-xl">${escapeHtml(it.fullName)}</h1>
<dl class="govuk-summary-list wf-detail-list">
  <div class="govuk-summary-list__row">
    <dt class="govuk-summary-list__key">Cached plat (avg)</dt>
    <dd class="govuk-summary-list__value">${fmtPlat(it.plat)}</dd>
  </div>
  <div class="govuk-summary-list__row">
    <dt class="govuk-summary-list__key">Cached volume</dt>
    <dd class="govuk-summary-list__value">${fmtVol(it.volume)}</dd>
  </div>
  <div class="govuk-summary-list__row">
    <dt class="govuk-summary-list__key">Cached ducats</dt>
    <dd class="govuk-summary-list__value">${fmtDucats(it.ducats)}</dd>
  </div>
</dl>
<p class="govuk-body"><a class="govuk-link" href="${
    escapeHtml(wfmItemUrl(it.slug))
  }" rel="noreferrer">View on warframe.market (opens in a new tab)</a></p>
<h2 class="govuk-heading-m">Live statistics — last 90 days</h2>
${liveStatsBlock(state.stats)}`;
  return shell(it.name, "wfmarket", content);
}

function liveStatsBlock(stats: LiveStats | null): string {
  if (stats === null) {
    return `<p class="govuk-body wf-muted">Fetching statistics from warframe.market…</p>`;
  }
  if (!stats.ok) {
    return `<div class="govuk-inset-text">
  <p class="govuk-body wf-!-no-margin-bottom">
    Live statistics are unavailable: ${
      escapeHtml(stats.error ?? "request failed")
    }.
    Cached values above are unaffected.
  </p>
</div>`;
  }
  if (stats.points.length === 0) {
    return `<div class="govuk-inset-text">
  <p class="govuk-body wf-!-no-margin-bottom">
    warframe.market reports no completed sales for this item in the last 90 days.
  </p>
</div>`;
  }
  const figures = `
<p class="govuk-body-s wf-muted">
  Latest median ${fmtPlat(stats.latestMedian)} · latest average ${
    fmtPlat(stats.latestAvg)
  } ·
  ${fmtVol(stats.totalVolume)} completed sales in 90 days · fetched ${
    escapeHtml(fmtDate(stats.fetchedAt))
  }
</p>`;
  return figures + "\n" + priceChartSvg(stats.points);
}

/* ------------------------------------------------------------------ */
/* Error pages                                                         */
/* ------------------------------------------------------------------ */

export function notFoundPageHtml(): string {
  const content = `
<h1 class="govuk-heading-xl">Page not found</h1>
<p class="govuk-body">The page you asked for does not exist.</p>
<p class="govuk-body"><a class="govuk-link" href="/logs">Return to Logs</a>.</p>`;
  return shell("Page not found", "logs", content);
}

export function errorPageHtml(message: string): string {
  const content = `
<h1 class="govuk-heading-xl">Something went wrong</h1>
<p class="govuk-body">${escapeHtml(message)}</p>
<p class="govuk-body"><a class="govuk-link" href="/logs">Return to Logs</a>.</p>`;
  return shell("Something went wrong", "logs", content);
}
