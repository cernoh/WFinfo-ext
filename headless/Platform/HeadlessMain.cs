using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;

namespace WFInfo
{
    /// <summary>
    /// Headless stand-in for the WPF <c>Main</c> application class.
    ///
    /// Only the static surface referenced by the shared core sources
    /// (Ocr.cs, Data.cs, TesseractService.cs, tests) is provided. Members that
    /// drive the Windows GUI are no-ops; nothing in a headless run executes them.
    /// </summary>
    internal static class Main
    {
        public static Data dataBase;

        /// <summary>Invariant culture keeps parsing/formatting deterministic on Linux.</summary>
        public static readonly CultureInfo culture = CultureInfo.InvariantCulture;

        /// <summary>Version reported by the headless runner. Matches the assembly version.</summary>
        public static string BuildVersion => AssemblyVersion;

        private static string AssemblyVersion =>
            typeof(Main).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        /// <summary>Application data root (AppData on Windows, ~/.config on Linux, XDG-aware).</summary>
        public static string AppPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WFInfo");

        public static void AddLog(string message)
        {
            Debug.WriteLine(message);
            try
            {
                string logPath = Path.Combine(AppPath, "debug.log");
                Directory.CreateDirectory(AppPath);
                File.AppendAllText(logPath, "[" + DateTime.UtcNow + "]   " + message + Environment.NewLine);
            }
            catch
            {
                // Logging must never take a headless run down.
            }
        }

        public static void StatusUpdate(string message, byte severity)
        {
            if (severity >= 2)
                AddLog("STATUS(" + severity + "): " + message);
        }

        public static void RunOnUIThread(Action action) => action();

        public static void SpawnErrorPopup(DateTime time) { }
        public static void SpawnErrorPopup(DateTime time, int durationMs) { }

        public static async Task UpdateMarketStatusAsync(string statusPayload)
        {
            await Task.CompletedTask.ConfigureAwait(false);
        }

        /// <summary>Replicates Main.cs: versions like "9.8.2" become comparable integers.</summary>
        public static int VersionToInteger(string version)
        {
            if (string.IsNullOrEmpty(version)) return 0;
            string[] parts = version.Split('.');
            int ret = 0;
            for (int i = 0; i < parts.Length && i < 3; i++)
            {
                if (int.TryParse(parts[i], NumberStyles.Integer, culture, out int p) && p >= 0)
                    ret += p * (int)Math.Pow(100, 2 - i);
            }
            return ret;
        }

        // --- Windows-only UI objects referenced by shared sources at compile time ---

        public static Overlay[] overlays = { new Overlay(), new Overlay(), new Overlay(), new Overlay() };
        public static SnapItOverlayWindow snapItOverlayWindow = new SnapItOverlayWindow();
        public static RewardWindow window = new RewardWindow();
        public static ListingHelper listingHelper = new ListingHelper();
        public static AutoCount autoCount = new AutoCount();
    }
}
