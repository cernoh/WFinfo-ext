using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace WFInfo.Scan
{
    /// <summary>
    /// Screen capture through grim (wlroots). No shared-code screenshot seam is
    /// involved: the scan writes a PNG and OCRs it from disk, exactly like the
    /// regression suite does with its fixtures.
    /// </summary>
    internal static class ScreenCapture
    {
        public static bool Available => Shell.Which("grim") != null;

        /// <summary>Output names reported by wlr-randr; empty when it is unavailable.</summary>
        public static List<string> ListOutputs()
        {
            var outputs = new List<string>();
            string randr = Shell.Which("wlr-randr");
            if (randr == null) return outputs;

            ShellResult json = Shell.Run(randr, new[] { "--json" }, 5000);
            if (json.ExitCode == 0 && !string.IsNullOrWhiteSpace(json.StdOut))
            {
                if (TryParseJsonOutputs(json.StdOut, outputs)) return outputs;
            }

            ShellResult plain = Shell.Run(randr, Array.Empty<string>(), 5000);
            if (plain.ExitCode == 0) ParseTextOutputs(plain.StdOut, outputs);
            return outputs;
        }

        private static bool TryParseJsonOutputs(string text, List<string> outputs)
        {
            try
            {
                var array = JArray.Parse(text);
                foreach (JToken token in array)
                {
                    if (!(token is JObject entry)) continue;
                    if (entry["enabled"] != null && !entry["enabled"].ToObject<bool>()) continue;
                    string name = entry["name"]?.ToString();
                    if (!string.IsNullOrEmpty(name)) outputs.Add(name);
                }
                return true;
            }
            catch (JsonException)
            {
                return false;
            }
        }

        /// <summary>Parses plain `wlr-randr` output: unindented line = head, "Enabled: yes" below it.</summary>
        private static void ParseTextOutputs(string text, List<string> outputs)
        {
            string current = null;
            bool enabled = true;

            foreach (string raw in (text ?? string.Empty).Split('\n'))
            {
                string line = raw.TrimEnd('\r');
                if (line.Length == 0) continue;

                if (!char.IsWhiteSpace(line[0]))
                {
                    if (current != null && enabled) outputs.Add(current);
                    current = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries)[0];
                    enabled = true;
                    continue;
                }

                string trimmed = line.Trim();
                if (trimmed.StartsWith("Enabled:", StringComparison.OrdinalIgnoreCase))
                    enabled = trimmed.IndexOf("yes", StringComparison.OrdinalIgnoreCase) >= 0;
            }

            if (current != null && enabled) outputs.Add(current);
        }

        /// <summary>
        /// Captures a PNG file: <paramref name="region"/> ("X,Y WxH", layout
        /// coordinates) wins over <paramref name="output"/>; both null captures
        /// every output as one image.
        /// </summary>
        public static bool Capture(string output, string region, string destination, out string error)
        {
            string grim = Shell.Which("grim");
            if (grim == null)
            {
                error = "grim is not on PATH";
                return false;
            }

            var arguments = new List<string>();
            if (!string.IsNullOrEmpty(region))
            {
                arguments.Add("-g");
                arguments.Add(region);
            }
            else if (!string.IsNullOrEmpty(output))
            {
                arguments.Add("-o");
                arguments.Add(output);
            }
            arguments.Add(destination);

            ShellResult result = Shell.Run(grim, arguments, 15000);
            if (result.ExitCode != 0 || !File.Exists(destination))
            {
                error = string.IsNullOrWhiteSpace(result.StdErr)
                    ? $"grim exited with {result.ExitCode}"
                    : result.StdErr.Trim();
                return false;
            }

            error = null;
            return true;
        }
    }
}
