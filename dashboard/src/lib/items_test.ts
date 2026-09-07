import { assertEquals } from "./testutil.ts";
import {
  indexMarket,
  lookupPrice,
  pricedCatalog,
  slugForName,
  wfmItemUrl,
} from "./items.ts";

const marketItems = {
  id1:
    "Loki Prime Systems|loki_prime_systems_blueprint|Loki Prime Systems Blueprint",
  id2: "Wyrm Prime Blueprint|wyrm_prime_blueprint|Wyrm Prime Blueprint",
  id3: "Frost Prime Chassis|frost_prime_chassis|Frost Prime Chassis",
};

const marketData = {
  "Loki Prime Systems Blueprint": {
    name: "Loki Prime Systems Blueprint",
    plat: "29.9",
    volume: "10",
    ducats: 0,
  },
  "Loki Prime Systems": {
    name: "Loki Prime Systems Blueprint",
    plat: "29.9",
    volume: "10",
    ducats: 100,
  },
  "Wyrm Prime Blueprint": {
    name: "Wyrm Prime Blueprint",
    plat: "13.5",
    volume: "21",
    ducats: 15,
  },
};

Deno.test("slugForName resolves aliases including blueprint variants", () => {
  const idx = indexMarket(marketItems, marketData);
  assertEquals(
    slugForName(idx, "Loki Prime Systems Blueprint"),
    "loki_prime_systems_blueprint",
  );
  assertEquals(
    slugForName(idx, "loki prime systems"),
    "loki_prime_systems_blueprint",
  );
  assertEquals(
    slugForName(idx, "Loki Prime Systems"),
    "loki_prime_systems_blueprint",
  );
  assertEquals(
    slugForName(idx, "Wyrm Prime Blueprint"),
    "wyrm_prime_blueprint",
  );
  assertEquals(slugForName(idx, "Nothing Prime"), null);
});

Deno.test("lookupPrice prefers the row that carries ducats", () => {
  const idx = indexMarket(marketItems, marketData);
  // The blueprint-name row has ducats 0; the part row (same name field) has 100.
  const price = lookupPrice(idx, "Loki Prime Systems Blueprint");
  assertEquals(price, { plat: 29.9, volume: 10, ducats: 100 });
});

Deno.test("lookupPrice resolves the plain catalog name too", () => {
  const idx = indexMarket(marketItems, marketData);
  const price = lookupPrice(idx, "Loki Prime Systems");
  assertEquals(price?.ducats, 100);
});

Deno.test("lookupPrice returns null for unknown names", () => {
  const idx = indexMarket(marketItems, marketData);
  assertEquals(lookupPrice(idx, "Totally Missing Prime"), null);
});

Deno.test("pricedCatalog attaches prices and sorts by name", () => {
  const idx = indexMarket(marketItems, marketData);
  const items = pricedCatalog(idx);
  assertEquals(items.length, 3);
  // Alphabetical: Frost Prime Chassis, Loki Prime Systems, Wyrm Prime Blueprint
  assertEquals(items[0].name, "Frost Prime Chassis");
  assertEquals(items[0].fullName, "Frost Prime Chassis");
  assertEquals(items[0].plat, null); // no price row present
  assertEquals(items[1].name, "Loki Prime Systems");
  assertEquals(items[1].ducats, 100);
  assertEquals(items[2].name, "Wyrm Prime Blueprint");
  assertEquals(items[2].plat, 13.5);
  assertEquals(items[2].ducats, 15);
});

Deno.test("indexMarket tolerates empty or malformed databases", () => {
  const idx = indexMarket(null, {});
  assertEquals(idx.items.length, 0);
  const idx2 = indexMarket({}, "not-an-object");
  assertEquals(idx2.items.length, 0);
  const idx3 = indexMarket({ a: "Only One Field" }, {});
  assertEquals(idx3.items.length, 0); // needs display|slug
});

Deno.test("wfmItemUrl builds the marketplace URL", () => {
  assertEquals(
    wfmItemUrl("loki_prime_systems_blueprint"),
    "https://warframe.market/items/loki_prime_systems_blueprint",
  );
});
