using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace WFInfo.Scan
{
    /// <summary>
    /// Warframe's EE.log: where it lives on Linux, and which line means "the
    /// game just showed a reward screen".
    ///
    /// The Windows app listens to the process debug output (DBWIN shared
    /// memory) and watches for the same messages. On Linux the game runs under
    /// Proton and writes the identical lines to
    /// <c>&lt;prefix&gt;/drive_c/users/&lt;user&gt;/AppData/Local/Warframe/EE.log</c>,
    /// so a tail of that file is the equivalent trigger.
    /// </summary>
    internal static class EeLog
    {
        /// <summary>Steam's Warframe app id (the compatdata prefix is named after it).</summary>
        private const string WarframeAppId = "230410";

        /// <summary>Path inside a Proton prefix, relative to <c>pfx</c>.</summary>
        private const string PrefixRelative = "drive_c/users/steamuser/AppData/Local/Warframe/EE.log";

        /// <summary>
        /// Lines that mean the game has shown a reward screen. These are the
        /// same two messages the Windows log watcher keys on (WFInfo/Data.cs,
        /// LogChanged); the current PC build writes "Got rewards" from
        /// ProjectionRewardChoice.lua.
        /// </summary>
        private static readonly string[] Triggers =
        {
            "Got rewards",
            "Pause countdown done",
        };

        /// <summary>True when the line announces a reward screen.</summary>
        public static bool IsRewardTrigger(string line)
        {
            if (string.IsNullOrEmpty(line)) return false;
            foreach (string trigger in Triggers)
            {
                if (line.IndexOf(trigger, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            }
            return false;
        }

        /// <summary>
        /// Resolves EE.log. An explicit path wins; otherwise the Proton prefix is
        /// found from the usual Steam roots and their extra library folders.
        /// Returns null when no log exists yet.
        /// </summary>
        public static string Resolve(string explicitPath)
        {
            if (!string.IsNullOrEmpty(explicitPath))
            {
                string given = Path.GetFullPath(explicitPath);
                return File.Exists(given) ? given : null;
            }

            string fromEnv = Environment.GetEnvironmentVariable("WFINFO_EE_LOG");
            if (!string.IsNullOrEmpty(fromEnv) && File.Exists(fromEnv)) return fromEnv;

            foreach (string root in SteamRoots())
            {
                string found = FindInSteamRoot(root);
                if (found != null) return found;
            }

            return null;
        }

        /// <summary>Candidate hints for a log that does not exist yet (for error messages).</summary>
        public static IEnumerable<string> CandidatePaths()
        {
            foreach (string root in SteamRoots())
            {
                yield return Path.Combine(root, "steamapps", "compatdata", WarframeAppId, "pfx", PrefixRelative);
            }
        }

        /// <summary>The Steam install roots on this machine, most likely first.</summary>
        private static IEnumerable<string> SteamRoots()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var roots = new List<string>();

            void Add(string candidate)
            {
                if (string.IsNullOrEmpty(candidate)) return;
                string full;
                try
                {
                    full = Path.GetFullPath(candidate);
                }
                catch (ArgumentException)
                {
                    return;
                }
                if (Directory.Exists(full) && !roots.Contains(full)) roots.Add(full);
            }

            // ~/.steam/steam and ~/.steam/root are symlinks into the real install.
            Add(Path.Combine(home, ".steam", "steam"));
            Add(Path.Combine(home, ".steam", "root"));
            Add(Path.Combine(home, ".local", "share", "Steam"));
            Add(Path.Combine(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"));

            // A custom install pointed at by the environment.
            Add(Environment.GetEnvironmentVariable("STEAM_ROOT"));

            // Steam libraries can sit on another drive; libraryfolders.vdf lists
            // them. Copy first: Add() appends to the same list.
            foreach (string root in roots.ToArray())
            {
                foreach (string library in LibraryFolders(root)) Add(library);
            }

            return roots;
        }

        /// <summary>Steam library paths from <c>steamapps/libraryfolders.vdf</c>.</summary>
        private static IEnumerable<string> LibraryFolders(string steamRoot)
        {
            string vdf = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
            string text;
            try
            {
                if (!File.Exists(vdf)) yield break;
                text = File.ReadAllText(vdf);
            }
            catch (IOException)
            {
                yield break;
            }

            // The file is Valve's KeyValues format: "path"  "/mnt/games/Steam"
            foreach (Match match in LibraryPathPattern.Matches(text))
            {
                yield return match.Groups[1].Value;
            }
        }

        private static readonly Regex LibraryPathPattern = new Regex(
            "\"path\"\\s+\"([^\"]+)\"", RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>The EE.log inside one Steam root's Warframe prefix, or null.</summary>
        private static string FindInSteamRoot(string steamRoot)
        {
            string candidate = Path.Combine(
                steamRoot, "steamapps", "compatdata", WarframeAppId, "pfx", PrefixRelative);
            return File.Exists(candidate) ? candidate : null;
        }
    }

    /// <summary>
    /// Poll-based tail of a text file.
    ///
    /// The log is replaced rather than appended to when the game starts a new
    /// session, and a replacement can be longer than what was already read — so
    /// a length comparison alone cannot detect it. Instead the tail keeps the
    /// last few bytes it consumed and checks that they are still at that offset:
    /// a mismatch means the file was replaced, and reading restarts from the
    /// beginning. A partial trailing line is held back until its newline arrives,
    /// so a line is never split across polls.
    /// </summary>
    internal sealed class LogTail
    {
        /// <summary>How many consumed bytes are re-checked for continuity.</summary>
        private const int CheckWindow = 64;

        private static readonly System.Text.Encoding Utf8 = new System.Text.UTF8Encoding(false);

        private readonly string _path;
        private long _position;
        private byte[] _tailCheck = Array.Empty<byte>();

        public LogTail(string path)
        {
            _path = path;
            try
            {
                using var stream = Open();
                _position = stream.Length;
                PrimeTailCheck(stream);
            }
            catch (IOException)
            {
                _position = 0;
            }
        }

        private FileStream Open() =>
            new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);

        /// <summary>Remembers the bytes just before the start position, for the continuity check.</summary>
        private void PrimeTailCheck(FileStream stream)
        {
            int count = (int)Math.Min(CheckWindow, _position);
            if (count <= 0) return;

            var tail = new byte[count];
            stream.Seek(_position - count, SeekOrigin.Begin);
            int read = stream.Read(tail, 0, count);
            if (read == count) _tailCheck = tail;
        }

        /// <summary>True when the bytes already consumed are still at their offset.</summary>
        private bool ContinuityHolds(FileStream stream)
        {
            if (_tailCheck.Length == 0 || _position < _tailCheck.Length) return true;

            var probe = new byte[_tailCheck.Length];
            stream.Seek(_position - probe.Length, SeekOrigin.Begin);
            if (stream.Read(probe, 0, probe.Length) != probe.Length) return false;
            return probe.AsSpan().SequenceEqual(_tailCheck);
        }

        /// <summary>
        /// Returns the complete lines appended since the previous call. A file
        /// that was truncated or replaced is re-read from the start.
        /// </summary>
        public IReadOnlyList<string> ReadNewLines()
        {
            var lines = new List<string>();

            try
            {
                using var stream = Open();
                long length = stream.Length;

                // Truncated, or replaced by a new session's log: start over.
                if (length < _position || !ContinuityHolds(stream))
                {
                    _position = 0;
                    _tailCheck = Array.Empty<byte>();
                }
                if (length <= _position) return lines;

                long startOffset = _position;
                var buffer = new byte[length - startOffset];
                stream.Seek(startOffset, SeekOrigin.Begin);
                int read = stream.Read(buffer, 0, buffer.Length);
                string text = Utf8.GetString(buffer, 0, read);

                int start = 0;
                for (int i = 0; i < text.Length; i++)
                {
                    if (text[i] != '\n') continue;

                    lines.Add(text.Substring(start, i - start).TrimEnd('\r'));
                    start = i + 1;
                }

                // Advance only past complete lines so a partial tail waits for
                // its newline. Byte counts (not char counts) keep the offset
                // exact for UTF-8.
                int consumed = Utf8.GetByteCount(text.Substring(0, start));
                _position = startOffset + consumed;
                UpdateTailCheck(buffer, consumed);
            }
            catch (IOException)
            {
                // The game may be mid-replacement; try again on the next poll.
            }

            return lines;
        }

        private void UpdateTailCheck(byte[] buffer, int consumed)
        {
            if (consumed <= 0) return;

            int count = Math.Min(CheckWindow, consumed);
            if (_tailCheck.Length != count) _tailCheck = new byte[count];
            Array.Copy(buffer, consumed - count, _tailCheck, 0, count);
        }
    }
}
