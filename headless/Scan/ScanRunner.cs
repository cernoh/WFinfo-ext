using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json;
using WFInfo.Services.WindowInfo;
using WFInfo.Settings;

namespace WFInfo.Scan
{
    /// <summary>
    /// One hotkey scan: capture the screen (or read a PNG), OCR the reward strip
    /// with WFInfo's own pipeline, price every recognised part from the local
    /// price cache (filling it from warframe.market on demand), pick the best
    /// platinum choice, then persist a scan record for the dashboard and show the
    /// verdict as a desktop notification.
    /// </summary>
    internal sealed class ScanRunner
    {
        /// <summary>A reward screen parses at least two parts; stop hunting other outputs then.</summary>
        private const int PartsGoodEnough = 2;

        /// <summary>Run files kept next to latest.json (mirrors the OCR-suite retention).</summary>
        private const int RetentionFiles = 60;

        private readonly ScanOptions _options;
        private readonly IWindowInfoService _window;
        private readonly MarketSheet _sheet;
        private readonly PriceCache _cache;
        private readonly ApplicationSettings _settings;

        public ScanRunner(ScanOptions options, IWindowInfoService window, MarketSheet sheet, PriceCache cache, ApplicationSettings settings)
        {
            _options = options;
            _window = window;
            _sheet = sheet;
            _cache = cache;
            _settings = settings;
        }

        /// <summary>Runs the scan; returns 0 when a record was produced, 1 when capture/OCR failed.</summary>
        public async Task<int> RunAsync()
        {
            DateTime startedUtc = DateTime.UtcNow;
            var watch = Stopwatch.StartNew();
            var result = new ScanResult
            {
                Version = 1,
                StartedAt = ScanPaths.Iso(startedUtc),
                CaptureSource = _options.File != null ? "file" : "grim",
            };

            string lastError = null;
            Bitmap acceptedImage = null;
            string acceptedPath = null;
            string acceptedTarget = null;
            bool acceptedIsTemporary = false;
            var acceptedParts = new List<string>();
            string acceptedTheme = null;
            double acceptedThemeWeight = 0;

            try
            {
                Directory.CreateDirectory(ScanPaths.ScansDir);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Cannot create {ScanPaths.ScansDir}: {ex.Message}");
                return 1;
            }

            foreach (CaptureCandidate candidate in BuildCandidates())
            {
                if (candidate.Kind == "grim")
                {
                    if (!ScreenCapture.Capture(candidate.Target, candidate.Path, out string captureError))
                    {
                        lastError = captureError;
                        continue;
                    }
                }

                Bitmap bitmap = TryLoad(candidate.Path, out string loadError);
                if (bitmap == null)
                {
                    lastError = loadError;
                    if (candidate.Kind == "grim") TryDelete(candidate.Path);
                    continue;
                }

                List<string> parts = RecognizeParts(bitmap, out string themeUsed, out double themeWeight);
                if (acceptedImage == null || parts.Count > acceptedParts.Count)
                {
                    acceptedImage?.Dispose();
                    if (acceptedIsTemporary) TryDelete(acceptedPath);

                    acceptedImage = bitmap;
                    acceptedPath = candidate.Path;
                    acceptedIsTemporary = candidate.Kind == "grim";
                    acceptedTarget = candidate.Kind == "file"
                        ? candidate.Path
                        : (string.IsNullOrEmpty(candidate.Target) ? "all" : candidate.Target);
                    acceptedParts = parts;
                    acceptedTheme = themeUsed;
                    acceptedThemeWeight = themeWeight;
                }
                else
                {
                    bitmap.Dispose();
                    if (candidate.Kind == "grim") TryDelete(candidate.Path);
                }

                if (acceptedParts.Count >= PartsGoodEnough) break;
            }

            if (acceptedImage == null)
            {
                result.Error = lastError ?? "no screenshot could be captured or read";
            }
            else
            {
                result.CaptureTarget = acceptedTarget;
                result.ScreenshotWidth = acceptedImage.Width;
                result.ScreenshotHeight = acceptedImage.Height;
                result.UiScaling = OCR.uiScaling;
                result.Theme = acceptedTheme;
                result.ThemeWeight = acceptedThemeWeight;

                result.ScreenshotPath = StoreScreenshot(acceptedPath) ?? acceptedPath;
                result.Choices = await PriceChoicesAsync(acceptedParts).ConfigureAwait(false);
                result.PriceCache = new PriceCacheStats
                {
                    Hits = _cache.Hits,
                    Fetched = _cache.Fetched,
                    Failed = _cache.Failed,
                    Entries = _cache.Entries,
                };
                _cache.Save();
                SetRecommendations(result);

                acceptedImage.Dispose();
                if (acceptedIsTemporary) TryDelete(acceptedPath);
            }

            result.FinishedAt = ScanPaths.Iso(DateTime.UtcNow);
            result.DurationMs = watch.ElapsedMilliseconds;

            CleanTempDirectory();

            Persist(result);
            Print(result);

            if (_options.Notify) SendNotification(result);
            if (_options.PrintJson) Console.WriteLine(JsonConvert.SerializeObject(result, Formatting.Indented));

            return result.Error == null ? 0 : 1;
        }

        /// <summary>
        /// Screens to try: the given file, a chosen output, or every output
        /// before the joined (all outputs) capture. The joined image puts the
        /// reward strip off-center whenever monitors sit side by side, so it is
        /// only a fallback — and the last resort when wlr-randr is unavailable.
        /// </summary>
        private List<CaptureCandidate> BuildCandidates()
        {
            var candidates = new List<CaptureCandidate>();

            if (_options.File != null)
            {
                string path = Path.GetFullPath(_options.File);
                candidates.Add(new CaptureCandidate("file", path, path));
                return candidates;
            }

            string directory = Path.Combine(Path.GetTempPath(), "wfinfo-scan-" + Environment.ProcessId);
            Directory.CreateDirectory(directory);

            if (!string.IsNullOrEmpty(_options.Output))
            {
                candidates.Add(new CaptureCandidate("grim", _options.Output, Path.Combine(directory, SafeName(_options.Output) + ".png")));
                return candidates;
            }

            foreach (string output in ScreenCapture.ListOutputs())
                candidates.Add(new CaptureCandidate("grim", output, Path.Combine(directory, SafeName(output) + ".png")));

            candidates.Add(new CaptureCandidate("grim", null, Path.Combine(directory, "all-outputs.png")));
            return candidates;
        }

        /// <summary>Prices every part concurrently: cache hits answer instantly, misses fetch in parallel.</summary>
        private async Task<List<ScanChoice>> PriceChoicesAsync(List<string> parts)
        {
            var timeToLive = TimeSpan.FromHours(_options.TtlHours);
            var entries = parts.Select(part => _sheet.Lookup(part)).ToList();
            var lookups = entries
                .Select(entry => entry.Slug == null
                    ? Task.FromResult<PriceQuote>(null)
                    : _cache.ResolveAsync(entry.Slug, timeToLive, _options.Refresh))
                .ToArray();

            PriceQuote[] quotes = await Task.WhenAll(lookups).ConfigureAwait(false);

            var choices = new List<ScanChoice>();
            for (int i = 0; i < parts.Count; i++)
            {
                SheetEntry entry = entries[i];
                PriceQuote quote = quotes[i];

                var choice = new ScanChoice
                {
                    Index = i + 1,
                    Part = parts[i],
                    Slug = entry.Slug,
                    Ducats = entry.Ducats,
                };

                if (quote != null)
                {
                    choice.Plat = quote.Plat;
                    choice.PlatSource = quote.Source;
                    choice.PlatFetchedAt = ScanPaths.Iso(quote.FetchedAtUtc);
                    choice.Volume = quote.Volume;
                }
                else if (entry.Plat != null)
                {
                    choice.Plat = entry.Plat;
                    choice.PlatSource = ScanChoice.SourceSheet;
                    choice.Volume = entry.Volume;
                }
                else
                {
                    choice.PlatSource = ScanChoice.SourceNone;
                }

                choices.Add(choice);
            }
            return choices;
        }

        /// <summary>
        /// OCRs the reward strip on one screenshot.
        ///
        /// The theme probe samples a single pixel column, so it misses when the UI
        /// scale differs, the capture is cropped, or the theme is new; the row
        /// filter then rejects every row and nothing is recognised. A failed
        /// attempt therefore retries once per theme before giving up. `--theme`
        /// pins the theme and skips the probe (and the retries).
        /// </summary>
        private List<string> RecognizeParts(Bitmap image, out string themeUsed, out double themeWeight)
        {
            WFtheme detected = OCR.GetThemeWeighted(out themeWeight, image);
            themeUsed = detected.ToString();

            if (_options.Theme != null && _options.Theme != WFtheme.AUTO)
            {
                themeUsed = _options.Theme.Value.ToString();
                _settings.ThemeSelection = _options.Theme.Value;
                List<string> pinned = ExtractParts(image);
                _settings.ThemeSelection = WFtheme.AUTO;
                return pinned;
            }

            List<string> parts = ExtractParts(image);
            if (parts.Count > 0) return parts;

            foreach (WFtheme theme in ScanOptions.ThemeCandidates())
            {
                if (theme == detected) continue;

                _settings.ThemeSelection = theme;
                List<string> attempt = ExtractParts(image);
                if (attempt.Count > 0)
                {
                    themeUsed = theme.ToString();
                    parts = attempt;
                    break;
                }
            }

            _settings.ThemeSelection = WFtheme.AUTO;
            return parts;
        }

        private List<string> ExtractParts(Bitmap image)
        {
            try
            {
                return OCR.ProcessRewardScreenForTest(image, _window) ?? new List<string>();
            }
            catch (Exception ex)
            {
                Main.AddLog("Reward extraction failed: " + ex.Message);
                return new List<string>();
            }
        }

        /// <summary>
        /// Flags the best platinum choice. Ties go to the higher ducat value and
        /// then to the later choice, matching WFInfo's Windows overlay ranking
        /// (WFInfo/Ocr.cs, the bestPlat/bestDucat loop).
        /// </summary>
        private static void SetRecommendations(ScanResult result)
        {
            ScanChoice bestPlat = null;
            ScanChoice bestDucats = null;

            foreach (ScanChoice choice in result.Choices)
            {
                if (choice.Plat != null && choice.Plat > 0)
                {
                    bool better = bestPlat == null
                        || choice.Plat > bestPlat.Plat
                        || (choice.Plat == bestPlat.Plat && (choice.Ducats ?? 0) >= (bestPlat.Ducats ?? 0));
                    if (better) bestPlat = choice;
                }

                if (choice.Ducats != null && (bestDucats == null || choice.Ducats >= bestDucats.Ducats))
                    bestDucats = choice;
            }

            if (bestPlat != null)
            {
                bestPlat.Best = true;
                result.Best = new ScanBest
                {
                    Index = bestPlat.Index,
                    Part = bestPlat.Part,
                    Plat = bestPlat.Plat.Value,
                };
            }

            if (bestDucats != null)
            {
                result.BestDucats = new ScanBestDucats
                {
                    Index = bestDucats.Index,
                    Part = bestDucats.Part,
                    Ducats = bestDucats.Ducats.Value,
                };
            }
        }

        /// <summary>Keeps the OCR'd screenshot next to the scan records for the dashboard.</summary>
        private static string StoreScreenshot(string sourcePath)
        {
            try
            {
                if (string.IsNullOrEmpty(sourcePath) || !File.Exists(sourcePath)) return null;
                if (string.Equals(Path.GetFullPath(sourcePath), Path.GetFullPath(ScanPaths.ScreenshotPng), StringComparison.Ordinal))
                    return ScanPaths.ScreenshotPng;

                File.Copy(sourcePath, ScanPaths.ScreenshotPng, overwrite: true);
                return ScanPaths.ScreenshotPng;
            }
            catch (Exception ex)
            {
                Main.AddLog("Failed to store the scan screenshot: " + ex.Message);
                return null;
            }
        }

        /// <summary>Writes latest.json plus one timestamped record, newest 60 kept.</summary>
        private static void Persist(ScanResult result)
        {
            try
            {
                string json = JsonConvert.SerializeObject(result, Formatting.Indented);
                File.WriteAllText(ScanPaths.LatestScan, json);

                string stamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmssfff", CultureInfo.InvariantCulture);
                File.WriteAllText(Path.Combine(ScanPaths.ScansDir, "scan-" + stamp + ".json"), json);

                foreach (FileInfo old in new DirectoryInfo(ScanPaths.ScansDir).GetFiles("*.json")
                    .OrderByDescending(f => f.LastWriteTimeUtc)
                    .Skip(RetentionFiles))
                {
                    try { old.Delete(); } catch { /* keep going; the next scan retries */ }
                }

                Main.AddLog("Scan persisted to: " + ScanPaths.ScansDir);
            }
            catch (Exception ex)
            {
                Main.AddLog("Failed to persist the scan: " + ex.Message);
            }
        }

        private static void SendNotification(ScanResult result)
        {
            string summary;
            string body;

            if (result.Choices.Count == 0)
            {
                summary = string.IsNullOrEmpty(result.Error) ? "No reward screen found" : "Scan failed";
                body = string.IsNullOrEmpty(result.Error)
                    ? $"Nothing was recognized on {result.CaptureTarget} — open the reward screen and press the scan hotkey."
                    : result.Error;
            }
            else
            {
                var lines = new List<string>();
                foreach (ScanChoice choice in result.Choices)
                {
                    string value = choice.Plat == null ? "no price" : FormatPlat(choice.Plat.Value) + "p";
                    string ducats = choice.Ducats == null ? string.Empty : $" · {choice.Ducats}d";
                    lines.Add($"{(choice.Best ? "★" : "  ")} {choice.Index}. {choice.Part} — {value}{ducats}");
                }

                if (result.Best == null)
                {
                    summary = "No price for this reward screen";
                }
                else
                {
                    summary = $"Take {result.Best.Part} — {FormatPlat(result.Best.Plat)}p";
                }

                if (result.BestDucats != null && (result.Best == null || result.BestDucats.Index != result.Best.Index))
                    lines.Add($"most ducats: {result.BestDucats.Part} ({result.BestDucats.Ducats}d)");

                body = string.Join("\n", lines);
            }

            Notifier.Send(summary, body);
        }

        private static void Print(ScanResult result)
        {
            Console.WriteLine("Warframe Info — reward screen scan");
            Console.WriteLine($"  started:  {result.StartedAt} ({result.DurationMs} ms)");

            if (result.ScreenshotWidth > 0)
            {
                Console.WriteLine(
                    $"  capture:  {result.CaptureSource} {result.CaptureTarget} " +
                    $"({result.ScreenshotWidth}x{result.ScreenshotHeight}, ui scale {result.UiScaling:F2})");
            }

            if (result.Choices.Count == 0)
            {
                Console.WriteLine($"  no choices: {result.Error ?? "no reward screen detected"}");
            }
            else
            {
                foreach (ScanChoice choice in result.Choices)
                {
                    string plat = (choice.Plat == null ? "-" : FormatPlat(choice.Plat.Value)).PadLeft(7);
                    string ducats = (choice.Ducats == null ? "-" : choice.Ducats.Value.ToString(CultureInfo.InvariantCulture)).PadLeft(4);
                    Console.WriteLine($"  {(choice.Best ? "*" : " ")} {choice.Index}. {choice.Part,-34} {plat}p {ducats}d  ({choice.PlatSource})");
                }

                Console.WriteLine(
                    $"  price cache: {result.PriceCache.Hits} hit, {result.PriceCache.Fetched} fetched, " +
                    $"{result.PriceCache.Failed} failed, {result.PriceCache.Entries} entries");

                if (result.Best != null)
                    Console.WriteLine($"  TAKE: {result.Best.Part} — {FormatPlat(result.Best.Plat)}p");
            }

            Console.WriteLine($"  saved:    {ScanPaths.LatestScan}");
        }

        private static Bitmap TryLoad(string path, out string error)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    error = "screenshot not found: " + path;
                    return null;
                }
                error = null;
                return new Bitmap(path);
            }
            catch (Exception ex)
            {
                error = $"cannot read screenshot {path}: {ex.Message}";
                return null;
            }
        }

        private static string FormatPlat(double plat) =>
            plat.ToString("0.#", CultureInfo.InvariantCulture);

        private static string SafeName(string value) =>
            new string(value.Select(c => char.IsLetterOrDigit(c) ? c : '_').ToArray());

        private static void TryDelete(string path)
        {
            try
            {
                if (!string.IsNullOrEmpty(path) && File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // temp files are best-effort
            }
        }

        /// <summary>Removes the per-run capture directory (files are already gone).</summary>
        private static void CleanTempDirectory()
        {
            try
            {
                string directory = Path.Combine(Path.GetTempPath(), "wfinfo-scan-" + Environment.ProcessId);
                if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
            }
            catch
            {
                // best-effort
            }
        }

        private readonly struct CaptureCandidate
        {
            public CaptureCandidate(string kind, string target, string path)
            {
                Kind = kind;
                Target = target;
                Path = path;
            }

            /// <summary>"grim" (capture now) or "file" (already on disk).</summary>
            public string Kind { get; }

            /// <summary>grim output name; null means every output.</summary>
            public string Target { get; }

            /// <summary>PNG to capture into, or the file to read.</summary>
            public string Path { get; }
        }
    }
}
