using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace WFInfo.Scan
{
    /// <summary>
    /// Automatic scanning: watch Warframe's EE.log and start a scan each time the
    /// game announces a reward screen, the Linux equivalent of the Windows app's
    /// "Auto" mode (WFInfo/Data.cs, LogChanged → AutoTriggered).
    ///
    /// The expensive parts — OCR engines, the market sheet, the price cache — are
    /// built once by the caller and reused, so the work per trigger is one
    /// capture plus the OCR, which is what keeps the answer fast.
    /// </summary>
    internal sealed class ScanWatcher
    {
        /// <summary>EE.log poll interval. The reward window is ~20 s; this is prompt.</summary>
        private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(250);

        private readonly string _logPath;
        private readonly ScanOptions _options;
        private readonly Func<Task<int>> _scan;
        private readonly TextWriter _out;

        public ScanWatcher(string logPath, ScanOptions options, Func<Task<int>> scan, TextWriter output)
        {
            _logPath = logPath;
            _options = options;
            _scan = scan;
            _out = output;
        }

        /// <summary>
        /// Tails EE.log until cancellation. Returns the exit code of the last
        /// scan when <c>--once</c> is set, else 0.
        /// </summary>
        public async Task<int> RunAsync(CancellationToken cancellation)
        {
            var tail = new LogTail(_logPath);
            DateTime lastScanUtc = DateTime.MinValue;
            int lastExit = 0;

            _out.WriteLine($"Watching {_logPath}");
            _out.WriteLine(
                $"  trigger: \"Got rewards\" / \"Pause countdown done\" · " +
                $"re-capture up to {_options.WaitSeconds:0.#} s · cooldown {_options.CooldownSeconds:0.#} s");

            while (!cancellation.IsCancellationRequested)
            {
                foreach (string line in tail.ReadNewLines())
                {
                    if (!EeLog.IsRewardTrigger(line)) continue;

                    TimeSpan sinceLast = DateTime.UtcNow - lastScanUtc;
                    if (sinceLast.TotalSeconds < _options.CooldownSeconds)
                    {
                        _out.WriteLine($"  trigger ignored (cooldown): {line.Trim()}");
                        continue;
                    }

                    _out.WriteLine($"  reward screen detected: {line.Trim()}");
                    lastScanUtc = DateTime.UtcNow;
                    lastExit = await _scan().ConfigureAwait(false);

                    if (_options.Once) return lastExit;
                }

                try
                {
                    await Task.Delay(PollInterval, cancellation).ConfigureAwait(false);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }

            _out.WriteLine("Stopped watching.");
            return _options.Once ? lastExit : 0;
        }
    }
}
