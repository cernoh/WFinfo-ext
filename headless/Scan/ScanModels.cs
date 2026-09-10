using System.Collections.Generic;
using Newtonsoft.Json;

namespace WFInfo.Scan
{
    /// <summary>
    /// One OCR scan of a Warframe reward screen: what the screen showed, the
    /// platinum/ducat value of every choice, and which choice pays best.
    ///
    /// Serialized to &lt;app dir&gt;/scans/latest.json and one timestamped file per
    /// run, so the Warframe Info dashboard can show the newest scan. The field
    /// list is documented in headless/README.md ("Scan"); the dashboard reader is
    /// dashboard/src/lib/scan.ts — change the two together.
    /// </summary>
    internal sealed class ScanResult
    {
        [JsonProperty("Version")] public int Version { get; set; } = 1;
        [JsonProperty("StartedAt")] public string StartedAt { get; set; }
        [JsonProperty("FinishedAt")] public string FinishedAt { get; set; }
        [JsonProperty("DurationMs")] public long DurationMs { get; set; }
        [JsonProperty("CaptureSource")] public string CaptureSource { get; set; }
        [JsonProperty("CaptureTarget")] public string CaptureTarget { get; set; }
        [JsonProperty("ScreenshotPath")] public string ScreenshotPath { get; set; }
        [JsonProperty("ScreenshotWidth")] public int ScreenshotWidth { get; set; }
        [JsonProperty("ScreenshotHeight")] public int ScreenshotHeight { get; set; }
        [JsonProperty("UiScaling")] public double UiScaling { get; set; }
        [JsonProperty("Choices")] public List<ScanChoice> Choices { get; set; } = new List<ScanChoice>();
        [JsonProperty("Best")] public ScanBest Best { get; set; }
        [JsonProperty("BestDucats")] public ScanBestDucats BestDucats { get; set; }
        [JsonProperty("PriceCache")] public PriceCacheStats PriceCache { get; set; } = new PriceCacheStats();
        [JsonProperty("Error")] public string Error { get; set; }
    }

    /// <summary>One reward-screen choice (screen order, <see cref="Index"/> starts at 1).</summary>
    internal sealed class ScanChoice
    {
        [JsonProperty("Index")] public int Index { get; set; }
        [JsonProperty("Part")] public string Part { get; set; }
        [JsonProperty("Slug")] public string Slug { get; set; }
        [JsonProperty("Plat")] public double? Plat { get; set; }
        [JsonProperty("PlatSource")] public string PlatSource { get; set; }
        [JsonProperty("PlatFetchedAt")] public string PlatFetchedAt { get; set; }
        [JsonProperty("Volume")] public long? Volume { get; set; }
        [JsonProperty("Ducats")] public int? Ducats { get; set; }
        [JsonProperty("Best")] public bool Best { get; set; }

        /// <summary>Source label for a choice whose price came from the local sheet.</summary>
        public const string SourceSheet = "sheet";

        /// <summary>Source label for a fresh warframe.market fetch.</summary>
        public const string SourceLive = "wfm";

        /// <summary>Source label for a cache hit.</summary>
        public const string SourceCache = "cache";

        /// <summary>Source label for a part with no price anywhere.</summary>
        public const string SourceNone = "none";
    }

    /// <summary>Best platinum choice of the scan.</summary>
    internal sealed class ScanBest
    {
        [JsonProperty("Index")] public int Index { get; set; }
        [JsonProperty("Part")] public string Part { get; set; }
        [JsonProperty("Plat")] public double Plat { get; set; }
    }

    /// <summary>Best ducat choice of the scan.</summary>
    internal sealed class ScanBestDucats
    {
        [JsonProperty("Index")] public int Index { get; set; }
        [JsonProperty("Part")] public string Part { get; set; }
        [JsonProperty("Ducats")] public int Ducats { get; set; }
    }

    /// <summary>Per-run price-resolution counters and the cache size afterwards.</summary>
    internal sealed class PriceCacheStats
    {
        [JsonProperty("Hits")] public int Hits { get; set; }
        [JsonProperty("Fetched")] public int Fetched { get; set; }
        [JsonProperty("Failed")] public int Failed { get; set; }
        [JsonProperty("Entries")] public int Entries { get; set; }
    }
}
