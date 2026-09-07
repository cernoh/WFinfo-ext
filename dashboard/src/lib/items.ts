/**
 * Market-database parsing: mirrors WFInfo's local JSON DBs.
 *
 *   market_items.json  — {<wfm item id>: "<display>|<url_name>[|<full name>]" }
 *                        (ReloadItems in Data.cs stores the prime catalog)
 *   market_data.json   — {<name>: {"name": ..., "plat": "…", "volume": "…", "ducats": n}}
 *                        (cached warframestat price sheet)
 *
 * The price sheet carries two rows for blueprint-style parts — one keyed
 * "Loki Prime Systems Blueprint" (wfm listing, ducats 0) and one keyed
 * "Loki Prime Systems" whose `name` field is the blueprint name (the actual
 * ducat value). Lookups therefore consider every entry whose key OR name
 * matches and prefer the row that carries a ducat value.
 */

export interface PriceEntry {
  plat: number | null;
  volume: number | null;
  ducats: number | null;
}

export interface MarketEntry extends PriceEntry {
  /** The JSON object key. */
  key: string;
  /** The entry's `name` field, when present. */
  displayName: string;
}

export interface CatalogItem extends PriceEntry {
  /** Display name, e.g. "Loki Prime Systems". */
  name: string;
  /** warframe.market url_name, e.g. "loki_prime_systems_blueprint". */
  slug: string;
  /** Canonical full name including " Blueprint", when the DB carries it. */
  fullName: string;
}

export interface MarketIndex {
  /** lower-cased name alias -> slug (built from market_items.json). */
  slugByAlias: Map<string, string>;
  /** slug -> canonical display info. */
  slugToName: Map<string, { name: string; fullName: string }>;
  /** market_data.json rows indexed by every key/name alias. */
  entriesByName: Map<string, MarketEntry[]>;
  /** Prime-part catalog rows (one per market_items.json value). */
  items: CatalogItem[];
}

const BLUEPRINT = " Blueprint";

function cleanNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length === 0) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseRow(raw: unknown): MarketEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  return {
    key: "",
    displayName: name,
    plat: cleanNum(o.plat),
    volume: cleanNum(o.volume),
    ducats: cleanNum(o.ducats),
  };
}

function aliasList(key: string, displayName: string): string[] {
  const names = new Set<string>();
  const push = (s: string): void => {
    const t = s.trim();
    if (t.length > 0) names.add(t.toLowerCase());
  };
  push(key);
  push(displayName);
  return [...names];
}

/** Higher score wins when several rows describe one item (ducats over zero). */
function rowScore(e: MarketEntry): number {
  let score = 0;
  if (e.ducats !== null && e.ducats > 0) score += 4;
  if (e.ducats !== null) score += 1;
  if (e.plat !== null) score += 1;
  if (e.volume !== null) score += 1;
  return score;
}

export function indexMarket(
  marketItemsRaw: unknown,
  marketDataRaw: unknown,
): MarketIndex {
  const slugByAlias = new Map<string, string>();
  const slugToName = new Map<string, { name: string; fullName: string }>();
  const items: CatalogItem[] = [];

  if (
    typeof marketItemsRaw === "object" && marketItemsRaw !== null &&
    !Array.isArray(marketItemsRaw)
  ) {
    for (const v of Object.values(marketItemsRaw as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      const parts = v.split("|").map((p) => p.trim());
      const display = parts[0] ?? "";
      const slug = parts[1] ?? "";
      const full = parts[2] ?? display;
      if (display.length === 0 || slug.length === 0) continue;
      items.push({
        name: display,
        slug,
        fullName: full,
        plat: null,
        volume: null,
        ducats: null,
      });
      const aliases = new Set<string>([display.toLowerCase()]);
      if (full !== display) aliases.add(full.toLowerCase());
      aliases.add(display.toLowerCase() + BLUEPRINT.toLowerCase());
      for (const a of aliases) {
        if (!slugByAlias.has(a)) slugByAlias.set(a, slug);
      }
      if (!slugToName.has(slug)) {
        slugToName.set(slug, { name: display, fullName: full });
      }
    }
  }

  const entriesByName = new Map<string, MarketEntry[]>();
  if (
    typeof marketDataRaw === "object" && marketDataRaw !== null &&
    !Array.isArray(marketDataRaw)
  ) {
    for (
      const [key, raw] of Object.entries(
        marketDataRaw as Record<string, unknown>,
      )
    ) {
      const row = parseRow(raw);
      if (row === null) continue;
      row.key = key;
      for (const alias of aliasList(key, row.displayName)) {
        const list = entriesByName.get(alias) ?? [];
        list.push(row);
        entriesByName.set(alias, list);
      }
    }
  }

  return { slugByAlias, slugToName, entriesByName, items };
}

/** Best price row for a name, or null when nothing matches. */
export function lookupPrice(
  index: MarketIndex,
  ...names: string[]
): PriceEntry | null {
  let best: MarketEntry | null = null;
  for (const name of names) {
    const list = index.entriesByName.get(name.trim().toLowerCase());
    if (!list) continue;
    for (const row of list) {
      if (best === null || rowScore(row) > rowScore(best)) best = row;
    }
  }
  if (best === null) return null;
  return { plat: best.plat, volume: best.volume, ducats: best.ducats };
}

/** Resolve a part name (as OCR'd on a reward screen) to its wfm slug. */
export function slugForName(index: MarketIndex, name: string): string | null {
  return index.slugByAlias.get(name.trim().toLowerCase()) ?? null;
}

/** Attach price rows to the catalog and sort it by display name. */
export function pricedCatalog(index: MarketIndex): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const item of index.items) {
    const price = lookupPrice(index, item.fullName, item.name);
    out.push({
      name: item.name,
      slug: item.slug,
      fullName: item.fullName,
      plat: price?.plat ?? null,
      volume: price?.volume ?? null,
      ducats: price?.ducats ?? null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return out;
}

export function wfmItemUrl(slug: string): string {
  return `https://warframe.market/items/${encodeURIComponent(slug)}`;
}
