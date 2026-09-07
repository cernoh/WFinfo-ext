using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Tesseract;
using WFInfo.Services.HDRDetection;
using WFInfo.Services.WarframeProcess;
using WFInfo.Services.WindowInfo;
using WFInfo.Settings;
using WFInfo.Tests;
using WFInfoMain = WFInfo.Main;

namespace WFInfo
{
    /// <summary>
    /// WFInfo.Headless — native Linux entry point for WFInfo's real OCR/theme core.
    ///
    /// The sources under headless/Platform plus the linked WFInfo core files form a
    /// net9.0 console build with no WPF/WinForms/Win32 dependencies, so the OCR test
    /// suite, the theme-detection runner, and engine self-checks run natively on Linux.
    ///
    /// Modes (mirroring CustomEntrypoint):
    ///   WFInfo.Headless --test map.json [results.json]   OCR regression suite
    ///   WFInfo.Headless map.json [results.json]          (flag is optional)
    ///   WFInfo.Headless --theme-debug <folder> [uiScale] theme detection runner
    ///   WFInfo.Headless --theme-test  <folder> [uiScale] alias of --theme-debug
    ///   WFInfo.Headless --selfcheck                      end-to-end OCR engine check
    ///
    /// Environment:
    ///   WFINFO_NATIVE_LIBS  directory with libtesseract50.so + libleptonica-1.82.0.so
    ///                       (see nix flake devShell; on Windows the app downloads them)
    ///   WFINFO_DATA_DIR     override for the application-data root (defaults to the
    ///                       OS XDG config dir; tessdata + market DBs land below it)
    /// </summary>
    internal static class HeadlessProgram
    {
        private const int ExitAllPassed = 0;
        private const int ExitSomeFailed = 1;
        private const int ExitFatal = 2;

        public static async Task<int> Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            ConfigureEnvironment();

            string[] clean = args ?? Array.Empty<string>();
            if (clean.Length == 0)
            {
                PrintUsage();
                return ExitFatal;
            }

            string first = clean[0];

            if (first.Equals("--test", StringComparison.OrdinalIgnoreCase) ||
                first.Equals("-test", StringComparison.OrdinalIgnoreCase) ||
                first.Equals("--map", StringComparison.OrdinalIgnoreCase))
            {
                return await RunOcrSuite(clean.Skip(1).ToArray()).ConfigureAwait(false);
            }

            if (first.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            {
                return await RunOcrSuite(clean).ConfigureAwait(false);
            }

            if (first.Equals("--theme-debug", StringComparison.OrdinalIgnoreCase) ||
                first.Equals("--theme-test", StringComparison.OrdinalIgnoreCase))
            {
                string folder = clean.Length > 1 ? clean[1] : ".";
                double overrideScale = clean.Length > 2 &&
                    double.TryParse(clean[2], System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out double scale)
                    ? scale : -1;
                return ThemeTestRunner.Run(folder, overrideScale);
            }

            if (first.Equals("--selfcheck", StringComparison.OrdinalIgnoreCase))
            {
                return await RunSelfCheck().ConfigureAwait(false);
            }

            PrintUsage();
            return ExitFatal;
        }

        private static void ConfigureEnvironment()
        {
            // Point .NET's ApplicationData folder at an override BEFORE any WFInfo
            // static initializer runs (those capture the path at class load).
            string dataDir = Environment.GetEnvironmentVariable("WFINFO_DATA_DIR");
            if (!string.IsNullOrEmpty(dataDir))
                Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", dataDir);

            // Native tesseract/leptonica location. The Windows app downloads these
            // to %APPDATA%; on Linux they come from the nix flake (or the distro).
            string nativeLibs = Environment.GetEnvironmentVariable("WFINFO_NATIVE_LIBS");
            if (!string.IsNullOrEmpty(nativeLibs))
                TesseractEnviornment.CustomSearchPath = nativeLibs;
        }

        private static async Task<int> RunOcrSuite(string[] args)
        {
            if (args.Length < 1)
            {
                Console.Error.WriteLine("Usage: WFInfo.Headless --test <map.json> [results.json]");
                return ExitFatal;
            }

            string mapPath = args[0];
            string outputPath = args.Length > 1
                ? args[1]
                : $"test_results_{DateTime.Now:yyyyMMdd_HHmmss}.json";

            Console.WriteLine("WFInfo OCR Test Runner (headless)");
            Console.WriteLine("=================================");
            Console.WriteLine($"Map:    {Path.GetFullPath(mapPath)}");
            Console.WriteLine($"Output: {Path.GetFullPath(outputPath)}");
            Console.WriteLine();

            if (!File.Exists(mapPath))
            {
                Console.Error.WriteLine($"ERROR: map file not found: {mapPath}");
                return ExitFatal;
            }

            WarnIfNativeLibsMissing();

            try
            {
                Console.WriteLine("Initializing services...");
                var settings = ApplicationSettings.GlobalSettings;
                settings.Debug = true;

                var processFinder = new HeadlessProcessFinder();
                var windowService = new HeadlessWindowInfoService();

                Console.WriteLine("Updating databases (network; first run may take a while)...");
                WFInfoMain.dataBase = new Data(ApplicationSettings.GlobalReadonlySettings, processFinder, windowService);
                await WFInfoMain.dataBase.Update().ConfigureAwait(false);
                Console.WriteLine("Databases ready.");

                Console.WriteLine("Initializing OCR engines (tessdata is fetched on demand)...");
                var suiteService = new TesseractService();
                try
                {
                    OCR.InitForTest(
                        suiteService,
                        ApplicationSettings.GlobalReadonlySettings,
                        windowService,
                        new HeadlessHDRDetector(false));
                    Console.WriteLine("OCR engine ready.");
                    Console.WriteLine();

                    var runner = new OCRTestRunner(windowService);
                    var results = runner.RunTestSuite(mapPath);
                    OCRTestRunner.SaveResults(results, outputPath);
                    PrintSummary(results);

                    Console.WriteLine();
                    Console.WriteLine($"Results saved to: {Path.GetFullPath(outputPath)}");

                    if (!string.IsNullOrEmpty(results.ErrorMessage))
                        return ExitFatal;
                    if (results.FailedTests > 0 || results.ErrorTests > 0)
                        return ExitSomeFailed;
                    return ExitAllPassed;
                }
                finally
                {
                    suiteService.Dispose();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Test execution failed: {ex}");
                return ExitFatal;
            }
        }

        private static void PrintSummary(TestSuiteResult results)
        {
            Console.WriteLine();
            Console.WriteLine("=== Summary ===");
            Console.WriteLine($"Total:  {results.TotalTests}");
            Console.WriteLine($"Passed: {results.PassedTests}");
            Console.WriteLine($"Failed: {results.FailedTests}");
            Console.WriteLine($"Errors: {results.ErrorTests}");
            Console.WriteLine($"Pass rate: {results.PassRate:F1}%  Overall accuracy: {results.OverallAccuracy:F1}%");
            if (!string.IsNullOrEmpty(results.ErrorMessage))
                Console.WriteLine($"Suite error: {results.ErrorMessage}");
        }

        /// <summary>
        /// Renders "Volt Prime Blueprint" through the real OCR pipeline to prove the
        /// full native stack (libtesseract + leptonica + tessdata + image handling)
        /// works on this machine — no game screenshot required.
        /// </summary>
        private static async Task<int> RunSelfCheck()
        {
            Console.WriteLine("WFInfo Headless Self-Check");
            Console.WriteLine("===========================");
            WarnIfNativeLibsMissing();

            try
            {
                var settings = ApplicationSettings.GlobalSettings;
                settings.Locale = "en";
                settings.Debug = false;

                var windowService = new HeadlessWindowInfoService();
                var tesseractService = new TesseractService();
                try
                {
                    OCR.InitForTest(
                        tesseractService,
                        ApplicationSettings.GlobalReadonlySettings,
                        windowService,
                        new HeadlessHDRDetector(false));

                    using (var image = RenderSampleImage())
                    {
                        string debugOut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WFInfo", "selfcheck.png");
                        Directory.CreateDirectory(Path.GetDirectoryName(debugOut));
                        image.Save(debugOut, System.Drawing.Imaging.ImageFormat.Png);

                        string text = string.Empty;
                        foreach (var engine in tesseractService.Engines)
                        {
                            if (engine == null) continue;
                            text = OCR.GetTextFromImage(image, engine);
                            if (!string.IsNullOrWhiteSpace(text)) break;
                        }
                        text = (text ?? string.Empty).Trim();

                        Console.WriteLine($"Recognized text: \"{text}\"");
                        bool ok = text.Contains("Volt", StringComparison.OrdinalIgnoreCase);
                        Console.WriteLine(ok ? "SELF-CHECK PASSED" : "SELF-CHECK FAILED (expected text containing 'Volt')");
                        return ok ? ExitAllPassed : ExitSomeFailed;
                    }
                }
                finally
                {
                    tesseractService.Dispose();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Self-check failed: {ex}");
                return ExitFatal;
            }
        }

        private static Bitmap RenderSampleImage()
        {
            int width = 1400, height = 260;
            var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bitmap))
            {
                g.Clear(Color.White);

                FontFamily family = ResolveFontFamily(g);
                using (var font = new Font(family, 64f, FontStyle.Regular, GraphicsUnit.Pixel))
                using (var brush = new SolidBrush(Color.Black))
                {
                    var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                    g.DrawString("Volt Prime Blueprint", font, brush, new RectangleF(0, 0, width, height), format);
                }
            }
            return bitmap;
        }

        private static FontFamily ResolveFontFamily(Graphics g)
        {
            try
            {
                var installed = new InstalledFontCollection();
                string preferred = installed.Families.FirstOrDefault(f =>
                    f.Name.Equals("DejaVu Sans", StringComparison.OrdinalIgnoreCase))?.Name;
                if (preferred != null)
                    return new FontFamily(preferred);
            }
            catch
            {
                // fall through to generic
            }
            return FontFamily.GenericSansSerif;
        }

        private static void WarnIfNativeLibsMissing()
        {
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WFINFO_NATIVE_LIBS")))
                Console.Error.WriteLine(
                    "WARNING: WFINFO_NATIVE_LIBS is not set; Tesseract native libraries may not load. " +
                    "Run inside `nix develop` or point it at a directory containing libtesseract50.so and libleptonica-1.82.0.so.");
        }

        private static void PrintUsage()
        {
            Console.WriteLine("WFInfo.Headless — native Linux runner for WFInfo's OCR/theme core");
            Console.WriteLine();
            Console.WriteLine("Usage:");
            Console.WriteLine("  WFInfo.Headless --test <map.json> [results.json]   Run OCR regression suite");
            Console.WriteLine("  WFInfo.Headless <map.json> [results.json]           (flag optional)");
            Console.WriteLine("  WFInfo.Headless --theme-debug <folder> [uiScale]   Run theme detection over PNGs");
            Console.WriteLine("  WFInfo.Headless --selfcheck                         Verify the OCR engine end-to-end");
            Console.WriteLine();
            Console.WriteLine("Environment:");
            Console.WriteLine("  WFINFO_NATIVE_LIBS  dir with libtesseract50.so + libleptonica-1.82.0.so");
            Console.WriteLine("  WFINFO_DATA_DIR     application-data root override (tessdata + market DBs)");
        }
    }
}
