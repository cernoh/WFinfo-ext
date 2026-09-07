using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Threading.Tasks;
using WFInfo.Services.Screenshot;
using WFInfo.Services.WarframeProcess;

namespace WFInfo
{
    /// <summary>Headless no-op sound player (the real one is WinForms/WPF-bound).</summary>
    internal interface ISoundPlayer
    {
        void Play();
    }

    /// <summary>Headless stub for the Windows EE.log watcher (DBWIN shared memory).</summary>
    internal class LogCapture : IDisposable
    {
        public LogCapture(IProcessFinder process) { }
        public event EventHandler<string> TextChanged;
        public void Dispose() { }
    }

    /// <summary>
    /// Headless stand-in for <c>CustomEntrypoint</c> helpers that shared code uses
    /// (traineddata download client + MD5 checksums). Behavior matches the Windows
    /// implementation: proxy-aware WebClient with a WFInfo user agent.
    /// </summary>
    internal static class CustomEntrypoint
    {
        private static readonly string build_version = typeof(CustomEntrypoint).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        public static WebClient CreateNewWebClient()
        {
            WebProxy proxy = null;
            string proxyString = Environment.GetEnvironmentVariable("http_proxy");
            if (!string.IsNullOrEmpty(proxyString))
                proxy = new WebProxy(new Uri(proxyString));

            WebClient client = new WebClient { Proxy = proxy };
            client.Headers.Add("User-Agent", "WFInfo/" + build_version);
            return client;
        }

        public static string GetMD5hash(string filePath)
        {
            using (var md5 = MD5.Create())
            using (var stream = File.OpenRead(filePath))
            {
                byte[] hash = md5.ComputeHash(stream);
                return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
            }
        }
    }
}

namespace WFInfo.Services.Screenshot
{
    /// <summary>
    /// Headless replacements for Windows-only screenshot backends. Kept only so the
    /// shared OCR sources type-check; real capture is never available headless.
    /// </summary>
    internal class GdiScreenshotService : IScreenshotService
    {
        public bool IsAvailable => false;
        public Task<List<Bitmap>> CaptureScreenshot() => Task.FromResult(new List<Bitmap>());
    }

    internal class WindowsCaptureScreenshotService : IScreenshotService
    {
        public bool IsAvailable => false;
        public Task<List<Bitmap>> CaptureScreenshot() => Task.FromResult(new List<Bitmap>());
    }
}

namespace WFInfo.Services.WindowInfo
{
    using System.Windows.Forms;

    /// <summary>
    /// Geometry provider for headless runs: the "game window" is the screenshot
    /// itself at DPI 1, anchored at the origin. Mirrors <c>SettableWindowService</c>
    /// semantics used by the theme test runner.
    /// </summary>
    internal class HeadlessWindowInfoService : IWindowInfoService
    {
        public double DpiScaling => 1.0;
        public double ScreenScaling => Math.Max(Window.Width / 1920.0, Window.Height / 1080.0);
        public Rectangle Window { get; private set; }
        public Point Center => new Point(Window.X + Window.Width / 2, Window.Y + Window.Height / 2);
        public Screen Screen => System.Windows.Forms.Screen.PrimaryScreen;

        public HeadlessWindowInfoService()
        {
            Window = new Rectangle(0, 0, 1920, 1080);
        }

        public void UpdateWindow() { }

        public void UseImage(Bitmap image)
        {
            if (image != null)
                Window = new Rectangle(0, 0, image.Width, image.Height);
        }
    }
}

namespace WFInfo.Services.WarframeProcess
{
    using System.Diagnostics;

    /// <summary>Reports "no game running" — used by the headless OCR test suite.</summary>
    internal class HeadlessProcessFinder : IProcessFinder
    {
        public Process Warframe => null;
        public System.Runtime.InteropServices.HandleRef HandleRef => default;
        public bool IsRunning => false;
        public bool GameIsStreamed => false;
        public event ProcessChangedArgs OnProcessChanged { add { } remove { } }
    }
}
