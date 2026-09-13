using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Newtonsoft.Json.Linq;

namespace WFInfo.Scan
{
    /// <summary>One entry of the local market databases (slug + cached price sheet values).</summary>
    internal sealed class SheetEntry
    {
        public string Slug;
        public double? Plat;
        public long? Volume;
        public int? Ducats;
    }

    /// <summary>
    /// Read-only view of WFInfo's cached market databases:
    ///   market_items.json  { &lt;id&gt;: "&lt;Display&gt;|&lt;url_name&gt;|&lt;Full name&gt;" }
    ///   market_data.json   { &lt;key&gt;: { name, plat, volume, ducats } }
    ///
    /// Both files are written by WFInfo/Data.cs; a scan reads them directly so a
    /// hotkey press never waits for a network database refresh.
    /// </summary>
    internal sealed class MarketSheet
    {
        private readonly Dictionary<string, string> _slugs = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, SheetEntry> _values = new Dictionary<string, SheetEntry>(StringComparer.Ordinal);

        public static MarketSheet Load(string itemsPath, string dataPath, out string warning)
        {
            var sheet = new MarketSheet();
            var warnings = new List<string>();

            if (File.Exists(itemsPath))
            {
                try
                {
                    sheet.IndexItems(JObject.Parse(File.ReadAllText(itemsPath)));
                }
                catch (Exception ex)
                {
                    warnings.Add($"market_items.json unreadable ({ex.Message})");
                }
            }
            else
            {
                warnings.Add("market_items.json missing");
            }

            if (File.Exists(dataPath))
            {
                try
                {
                    sheet.IndexPrices(JObject.Parse(File.ReadAllText(dataPath)));
                }
                catch (Exception ex)
                {
                    warnings.Add($"market_data.json unreadable ({ex.Message})");
                }
            }
            else
            {
                warnings.Add("market_data.json missing");
            }

            warning = warnings.Count == 0 ? null : string.Join("; ", warnings);
            return sheet;
        }

        private void IndexItems(JObject items)
        {
            foreach (var property in items.Properties())
            {
                string[] fields = (property.Value?.ToString() ?? string.Empty).Split('|');
                if (fields.Length < 2) continue;
                string slug = fields[1];
                if (string.IsNullOrEmpty(slug)) continue;

                if (!string.IsNullOrEmpty(fields[0])) _slugs[fields[0]] = slug;
                if (fields.Length > 2 && !string.IsNullOrEmpty(fields[2])) _slugs[fields[2]] = slug;
            }
        }

        /// <summary>
        /// Indexes price-sheet rows by both their key and their inner `name`: a
        /// blueprint part appears twice (ducats 0 under "X Blueprint", real ducats
        /// under "X"), and the row with ducats &gt; 0 is the one that counts.
        /// </summary>
        private void IndexPrices(JObject prices)
        {
            foreach (var property in prices.Properties())
            {
                if (!(property.Value is JObject row)) continue;

                var entry = new SheetEntry
                {
                    Slug = null,
                    Plat = ParseDouble(row["plat"]),
                    Volume = ParseLong(row["volume"]),
                    Ducats = ParseInt(row["ducats"]),
                };

                Merge(property.Name, entry);
                string name = row["name"]?.ToString();
                if (!string.IsNullOrEmpty(name)) Merge(name, entry);
            }
        }

        private void Merge(string key, SheetEntry entry)
        {
            if (string.IsNullOrEmpty(key)) return;
            if (_values.TryGetValue(key, out SheetEntry existing) &&
                existing.Ducats.GetValueOrDefault() > 0 &&
                entry.Ducats.GetValueOrDefault() <= 0)
            {
                return;
            }
            _values[key] = entry;
        }

        /// <summary>Lookup for an OCR-corrected part name; never null (empty entry when unknown).</summary>
        public SheetEntry Lookup(string partName)
        {
            var entry = new SheetEntry();
            if (string.IsNullOrEmpty(partName)) return entry;

            _slugs.TryGetValue(partName, out string slug);
            entry.Slug = slug;

            if (_values.TryGetValue(partName, out SheetEntry values))
            {
                entry.Plat = values.Plat;
                entry.Volume = values.Volume;
                entry.Ducats = values.Ducats;
            }
            return entry;
        }

        public int Count => _values.Count;

        private static double? ParseDouble(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            string text = token.ToString();
            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double value) ? value : (double?)null;
        }

        private static long? ParseLong(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            return long.TryParse(token.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long value) ? value : (long?)null;
        }

        private static int? ParseInt(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            return int.TryParse(token.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int value) ? value : (int?)null;
        }
    }
}
