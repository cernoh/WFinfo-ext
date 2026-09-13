using System.Collections.Generic;

namespace WFInfo.Scan
{
    /// <summary>
    /// Desktop notification for the scan verdict. notify-send posts through the
    /// session's org.freedesktop.Notifications daemon (Noctalia on the reference
    /// host), so the recommendation shows above the game as an overlay without
    /// taking keyboard focus away from it.
    /// </summary>
    internal static class Notifier
    {
        public static bool Send(string summary, string body)
        {
            string executable = Shell.Which("notify-send");
            if (executable == null)
            {
                Main.AddLog("notify-send is not on PATH; skipping the scan notification");
                return false;
            }

            var arguments = new List<string>
            {
                "--app-name=Warframe Info",
                "--urgency=normal",
                "--icon=dialog-information",
                "--expire-time=20000",
                summary,
            };
            if (!string.IsNullOrEmpty(body)) arguments.Add(body);

            ShellResult result = Shell.Run(executable, arguments, 5000);
            return result.ExitCode == 0;
        }
    }
}
