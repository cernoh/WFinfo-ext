using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace WFInfo.Scan
{
    /// <summary>Cached platinum quote for one warframe.market slug.</summary>
    internal sealed class CachedPrice
    {
        [JsonProperty("plat")] public double Plat { get; set; }
        [JsonProperty("volume")] public long Volume { get; set; }
        [JsonProperty("fetchedAt")] public string FetchedAt { get; set; }
    }

    internal sealed class PriceCacheFile
    {
        [JsonProperty("version")] public int Version { get; set; } = 1;
        [JsonProperty("updated")] public string Updated { get; set; }

        [JsonProperty("prices")]
        public Dictionary<string, CachedPrice> Prices { get; set; } = new Dictionary<string, CachedPrice>(StringComparer.Ordinal);
    }

    /// <summary>A resolved price plus how it was obtained.</summary>
    internal sealed class PriceQuote
    {
        public double Plat { get; set; }
        public long Volume { get; set; }
        public DateTime FetchedAtUtc { get; set; }
        public string Source { get; set; }
    }

    /// <summary>
    /// Local platinum-price cache with on-demand warframe.market refresh.
    ///
    /// A scan must be fast, so prices live in &lt;app dir&gt;/price_cache.json: a fresh
    /// entry (within the TTL) answers instantly and only missing/stale slugs hit
    /// warframe.market, concurrently. The fetch parses the same public statistics
    /// endpoint the dashboard's live panel uses, reading the newest point of the
    /// 48-hour window (median, falling back to avg_price) and the traded volume.
    /// </summary>
    internal sealed class PriceCache
    {
        private const string StatisticsUrl = "https://api.warframe.market/v1/items/{0}/statistics";

        private readonly string _path;
        private readonly HttpClient _http;
        private readonly Dictionary<string, CachedPrice> _prices = new Dictionary<string, CachedPrice>(StringComparer.Ordinal);

        public PriceCache(string path, HttpClient http)
        {
            _path = path;
            _http = http;
            Load();
        }

        /// <summary>Slugs answered from the cache during this run.</summary>
        public int Hits { get; private set; }

        /// <summary>Slugs fetched from warframe.market during this run.</summary>
        public int Fetched { get; private set; }

        /// <summary>Slugs whose fetch failed (the caller falls back to the sheet).</summary>
        public int Failed { get; private set; }

        public int Entries => _prices.Count;

        /// <summary>Returns a quote for the slug, or null when it cannot be priced.</summary>
        public async Task<PriceQuote> ResolveAsync(string slug, TimeSpan ttl, bool refresh)
        {
            if (string.IsNullOrEmpty(slug)) return null;

            if (!refresh && _prices.TryGetValue(slug, out CachedPrice cached) && IsFresh(cached, ttl))
            {
                Hits++;
                return new PriceQuote
                {
                    Plat = cached.Plat,
                    Volume = cached.Volume,
                    FetchedAtUtc = ParseIso(cached.FetchedAt) ?? DateTime.UtcNow,
                    Source = ScanChoice.SourceCache,
                };
            }

            CachedPrice fetched = await FetchAsync(slug).ConfigureAwait(false);
            if (fetched == null)
            {
                Failed++;
                return null;
            }

            _prices[slug] = fetched;
            Fetched++;
            Save();
            return new PriceQuote
            {
                Plat = fetched.Plat,
                Volume = fetched.Volume,
                FetchedAtUtc = ParseIso(fetched.FetchedAt) ?? DateTime.UtcNow,
                Source = ScanChoice.SourceLive,
            };
        }

        private static bool IsFresh(CachedPrice price, TimeSpan ttl)
        {
            DateTime? fetchedAt = ParseIso(price.FetchedAt);
            return fetchedAt != null && DateTime.UtcNow - fetchedAt.Value <= ttl;
        }

        private async Task<CachedPrice> FetchAsync(string slug)
        {
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Get, string.Format(StatisticsUrl, Uri.EscapeDataString(slug))))
                {
                    request.Headers.TryAddWithoutValidation("Accept", "application/json");
                    request.Headers.TryAddWithoutValidation("Language", "en");

                    using (var timeout = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(12)))
                    using (var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            Main.AddLog($"Price fetch for {slug} failed: HTTP {(int)response.StatusCode}");
                            return null;
                        }

                        string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        JArray points = JObject.Parse(body)["payload"]?["statistics_closed"]?["48hours"] as JArray;
                        if (points == null || points.Count == 0) return null;

                        long volume = 0;
                        double? plat = null;
                        for (int i = 0; i < points.Count; i++)
                        {
                            JToken point = points[i];
                            volume += ReadLong(point["volume"]) ?? 0;

                            double? median = ReadDouble(point["median"]) ?? ReadDouble(point["avg_price"]);
                            if (median != null) plat = median; // newest point holding a value wins
                        }

                        if (plat == null) return null;

                        return new CachedPrice
                        {
                            Plat = Math.Round(plat.Value, 1),
                            Volume = volume,
                            FetchedAt = ScanPaths.Iso(DateTime.UtcNow),
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                Main.AddLog($"Price fetch for {slug} failed: {ex.Message}");
                return null;
            }
        }

        private void Load()
        {
            try
            {
                if (!File.Exists(_path)) return;
                var file = JsonConvert.DeserializeObject<PriceCacheFile>(File.ReadAllText(_path));
                if (file?.Prices == null) return;
                foreach (var pair in file.Prices)
                {
                    if (!string.IsNullOrEmpty(pair.Key) && pair.Value != null) _prices[pair.Key] = pair.Value;
                }
            }
            catch (Exception ex)
            {
                Main.AddLog($"Price cache unreadable, starting empty: {ex.Message}");
            }
        }

        /// <summary>Writes the cache through a temp file so a killed scan cannot tear it.</summary>
        public void Save()
        {
            try
            {
                var file = new PriceCacheFile { Updated = ScanPaths.Iso(DateTime.UtcNow), Prices = _prices };
                Directory.CreateDirectory(Path.GetDirectoryName(_path));
                string temp = _path + ".tmp";
                File.WriteAllText(temp, JsonConvert.SerializeObject(file, Formatting.Indented));
                File.Move(temp, _path, overwrite: true);
            }
            catch (Exception ex)
            {
                Main.AddLog($"Price cache write failed: {ex.Message}");
            }
        }

        private static DateTime? ParseIso(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            return DateTime.TryParse(text, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                out DateTime parsed) ? parsed : (DateTime?)null;
        }

        private static double? ReadDouble(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            return double.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double value) ? value : (double?)null;
        }

        private static long? ReadLong(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            return long.TryParse(token.ToString(), System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out long value) ? value : (long?)null;
        }
    }
}
