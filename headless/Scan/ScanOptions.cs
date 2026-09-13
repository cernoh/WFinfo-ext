using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace WFInfo.Scan
{
    /// <summary>
    /// Paths the scan reads and writes inside the WFInfo application-data dir
    /// (same root the OCR suite, the market DBs and the dashboard already use).
    /// </summary>
    internal static class ScanPaths
    {
        public static string AppDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WFInfo");

        public static string ScansDir => Path.Combine(AppDir, "scans");
        public static string LatestScan => Path.Combine(ScansDir, "latest.json");
        public static string ScreenshotPng => Path.Combine(ScansDir, "last.png");
        public static string PriceCache => Path.Combine(AppDir, "price_cache.json");
        public static string MarketItems => Path.Combine(AppDir, "market_items.json");
        public static string MarketData => Path.Combine(AppDir, "market_data.json");

        /// <summary>
        /// Relic/market name translation table ({relic_name: market_name}). The
        /// reward pipeline's English name lookup reads it, so a scan without it
        /// throws in <c>Data.GetPartName</c>.
        /// </summary>
        public static string NameData => Path.Combine(AppDir, "name_data.json");

        /// <summary>ISO-8601 UTC with milliseconds, the timestamp format of the scan contract.</summary>
        public static string Iso(DateTime utc) =>
            utc.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Command-line options of `WFInfo.Headless --scan`.</summary>
    internal sealed class ScanOptions
    {
        /// <summary>OCR this PNG instead of capturing the screen.</summary>
        public string File { get; private set; }

        /// <summary>grim output name (monitor); null captures every output.</summary>
        public string Output { get; private set; }

        /// <summary>
        /// grim region ("X,Y WxH", layout coordinates) to capture instead of a
        /// whole output — how the dashboard captures one window. Null captures
        /// an output or every output.
        /// </summary>
        public string Region { get; private set; }

        /// <summary>Force this UI theme instead of the automatic probe; null = auto.</summary>
        public WFtheme? Theme { get; private set; }

        /// <summary>Ignore the price-cache TTL for this run.</summary>
        public bool Refresh { get; private set; }

        public double TtlHours { get; private set; } = 6;

        /// <summary>Post a desktop notification with the recommendation.</summary>
        public bool Notify { get; private set; } = true;

        /// <summary>Print the scan record JSON to stdout.</summary>
        public bool PrintJson { get; private set; }

        /// <summary>
        /// Keep running: watch Warframe's EE.log and scan each time the game
        /// shows a reward screen, instead of scanning once.
        /// </summary>
        public bool Watch { get; private set; }

        /// <summary>
        /// Watch mode: scan on the first trigger, then exit. Used to prove the
        /// trigger path without a game session.
        /// </summary>
        public bool Once { get; private set; }

        /// <summary>Explicit EE.log path; null auto-detects the Proton prefix.</summary>
        public string LogPath { get; private set; }

        /// <summary>
        /// Seconds to keep re-capturing after a trigger until at least one
        /// reward part is recognised. The game writes the trigger line before
        /// the reward panel is on screen, so a single capture races it.
        /// Default 10 in watch mode, 0 (one capture) otherwise.
        /// </summary>
        public double WaitSeconds => _waitSeconds ?? (Watch ? 10 : 0);

        private double? _waitSeconds;

        /// <summary>Seconds a fresh trigger is ignored after a scan starts.</summary>
        public double CooldownSeconds { get; private set; } = 5;

        public bool Help { get; private set; }

        /// <summary>Parses scan arguments; throws <see cref="ArgumentException"/> on bad input.</summary>
        public static ScanOptions Parse(string[] args)
        {
            var options = new ScanOptions();

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                switch (arg.ToLowerInvariant())
                {
                    case "--file":
                        options.File = RequireValue(args, ref i, arg);
                        break;
                    case "--output":
                        options.Output = RequireValue(args, ref i, arg);
                        break;
                    case "--region":
                        options.Region = ParseRegion(RequireValue(args, ref i, arg));
                        break;
                    case "--theme":
                        options.Theme = ParseTheme(RequireValue(args, ref i, arg));
                        break;
                    case "--refresh":
                        options.Refresh = true;
                        break;
                    case "--ttl":
                        string ttl = RequireValue(args, ref i, arg);
                        if (!double.TryParse(ttl, System.Globalization.NumberStyles.Float,
                                System.Globalization.CultureInfo.InvariantCulture, out double hours) || hours <= 0)
                            throw new ArgumentException($"--ttl expects a positive number of hours, got '{ttl}'");
                        options.TtlHours = hours;
                        break;
                    case "--no-notify":
                        options.Notify = false;
                        break;
                    case "--json":
                        options.PrintJson = true;
                        break;
                    case "--watch":
                        options.Watch = true;
                        break;
                    case "--once":
                        options.Once = true;
                        break;
                    case "--log":
                        options.LogPath = RequireValue(args, ref i, arg);
                        break;
                    case "--wait":
                        options._waitSeconds = ParseSeconds(RequireValue(args, ref i, arg), arg);
                        break;
                    case "--cooldown":
                        options.CooldownSeconds = ParseSeconds(RequireValue(args, ref i, arg), arg);
                        break;
                    case "-h":
                    case "--help":
                        options.Help = true;
                        break;
                    default:
                        throw new ArgumentException($"Unknown scan option: {arg}");
                }
            }

            // --once is a bounded watch: wait for one trigger, scan, exit.
            if (options.Once) options.Watch = true;
            if (options.Watch && options.File != null)
                throw new ArgumentException("--watch reads the live screen; --file cannot be combined with it");

            return options;
        }

        private static string RequireValue(string[] args, ref int index, string flag)
        {
            if (index + 1 >= args.Length)
                throw new ArgumentException($"{flag} expects a value");
            return args[++index];
        }

        /// <summary>Parses a non-negative seconds value; throws on bad input.</summary>
        private static double ParseSeconds(string value, string flag)
        {
            if (!double.TryParse(value, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out double seconds) || seconds < 0)
            {
                throw new ArgumentException($"{flag} expects a number of seconds >= 0, got '{value}'");
            }
            return seconds;
        }

        /// <summary>grim -g accepts "X,Y WxH" in layout coordinates; anything else is a typo.</summary>
        private static readonly Regex RegionPattern = new Regex(
            @"^\s*(-?\d+)\s*,\s*(-?\d+)\s+(\d+)\s*[xX]\s*(\d+)\s*$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>Normalizes a grim region; throws <see cref="ArgumentException"/> on bad input.</summary>
        private static string ParseRegion(string value)
        {
            Match match = RegionPattern.Match(value ?? string.Empty);
            int width = 0;
            int height = 0;
            bool sized = match.Success
                && int.TryParse(match.Groups[3].Value, out width) && width > 0
                && int.TryParse(match.Groups[4].Value, out height) && height > 0;

            if (!sized)
                throw new ArgumentException(
                    $"--region expects \"X,Y WxH\" with a positive size (for example \"10,44 1900x1026\"), got '{value}'");

            return $"{match.Groups[1].Value},{match.Groups[2].Value} {width}x{height}";
        }

        private static WFtheme ParseTheme(string value)
        {
            if (value.Equals("auto", StringComparison.OrdinalIgnoreCase)) return WFtheme.AUTO;
            if (Enum.TryParse(value, ignoreCase: true, out WFtheme parsed) &&
                Enum.IsDefined(typeof(WFtheme), parsed) &&
                parsed != WFtheme.AUTO && parsed != WFtheme.CUSTOM)
            {
                return parsed;
            }

            throw new ArgumentException(
                $"Unknown theme '{value}' (known: auto, {string.Join(", ", ThemeCandidates())})");
        }

        /// <summary>Real themes, in enum order: the AUTO/CUSTOM pseudo-members are excluded.</summary>
        public static IEnumerable<WFtheme> ThemeCandidates() =>
            Enum.GetValues(typeof(WFtheme)).Cast<WFtheme>().Where(t => t != WFtheme.AUTO && t != WFtheme.CUSTOM);

        /// <summary>Comma-separated theme names, for help text.</summary>
        public static string ThemeNames() => string.Join(", ", ThemeCandidates());
    }
}
