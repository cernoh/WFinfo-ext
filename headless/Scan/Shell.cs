using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace WFInfo.Scan
{
    internal readonly struct ShellResult
    {
        public ShellResult(int exitCode, string stdout, string stderr)
        {
            ExitCode = exitCode;
            StdOut = stdout ?? string.Empty;
            StdErr = stderr ?? string.Empty;
        }

        public int ExitCode { get; }
        public string StdOut { get; }
        public string StdErr { get; }
    }

    /// <summary>
    /// Minimal external-command helper for the Linux scan path (grim, wlr-randr,
    /// notify-send). ArgumentList is used, so no shell quoting is involved.
    /// </summary>
    internal static class Shell
    {
        /// <summary>Resolves an executable on PATH; null when it is not installed.</summary>
        public static string Which(string executable)
        {
            string path = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrEmpty(path)) return null;

            foreach (string dir in path.Split(Path.PathSeparator))
            {
                if (string.IsNullOrEmpty(dir)) continue;
                string candidate;
                try
                {
                    candidate = Path.Combine(dir, executable);
                }
                catch (ArgumentException)
                {
                    continue;
                }
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }

        /// <summary>Runs a command and captures its output; a timeout kills the process tree.</summary>
        public static ShellResult Run(string executable, IEnumerable<string> arguments, int timeoutMs = 15000)
        {
            var psi = new ProcessStartInfo(executable)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (string argument in arguments ?? Enumerable.Empty<string>())
            {
                psi.ArgumentList.Add(argument);
            }

            try
            {
                using (var process = Process.Start(psi))
                {
                    if (process == null)
                        return new ShellResult(-1, string.Empty, "failed to start " + executable);

                    string stdout = process.StandardOutput.ReadToEnd();
                    string stderr = process.StandardError.ReadToEnd();
                    if (!process.WaitForExit(timeoutMs))
                    {
                        try { process.Kill(true); } catch { /* already gone */ }
                        return new ShellResult(-1, stdout, $"{executable} timed out after {timeoutMs} ms");
                    }
                    return new ShellResult(process.ExitCode, stdout, stderr);
                }
            }
            catch (Exception ex)
            {
                return new ShellResult(-1, string.Empty, $"{executable}: {ex.Message}");
            }
        }
    }
}
