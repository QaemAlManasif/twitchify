using System.Diagnostics;
using System.Reflection;
using Microsoft.Win32;

namespace TwitchWatchHelperSetup;

// One-click installer for the Watch Sync helper: drops the exe in
// %LOCALAPPDATA%\TwitchModeration, registers it as a per-user Run entry
// (it is resident but asleep until iCUE runs — Deckord's pattern), registers
// the twitchify-helper:// scheme so the widget can start it on demand, adds
// a Settings → Apps entry, and launches it.
//
//   /silent        install without a window
//   /noautostart   no Run entry: the widget starts it, it exits with iCUE
//   /uninstall     remove it again
internal static class SetupProgram
{
    private const string AppName = "TwitchWatchHelper";
    private const string DisplayName = "Twitchify Watch Sync Helper";
    private const string Version = "1.0.0";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string SchemeKey = @"Software\Classes\twitchify-helper";
    private const string UninstallKey =
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchWatchHelper";

    private static string InstallDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TwitchModeration");

    private static string HelperPath => Path.Combine(InstallDir, "TwitchWatchHelper.exe");
    private static string SetupPath => Path.Combine(InstallDir, "Twitch Watch Sync Setup.exe");

    [STAThread]
    private static void Main(string[] args)
    {
        var silent = args.Contains("/silent", StringComparer.OrdinalIgnoreCase);
        var uninstall = args.Contains("/uninstall", StringComparer.OrdinalIgnoreCase);
        var autostart = !args.Contains("/noautostart", StringComparer.OrdinalIgnoreCase);

        try
        {
            if (uninstall)
            {
                Uninstall();
                if (!silent) Say("Twitchify Watch Sync Helper has been removed.", "Uninstalled");
                return;
            }

            Install(autostart);
            if (!silent)
            {
                Say("Twitchify Watch Sync Helper is installed and running.\n\n" +
                    (autostart
                        ? "It runs with iCUE: it has no window, sleeps until iCUE is open and " +
                          "does nothing otherwise. "
                        : "The widget starts it when needed and it quits when iCUE closes. ") +
                    "Next, load the Watch Sync extension in your browser, then turn on " +
                    "\"Channels open in my browser\" in the widget's Preferences.",
                    "Installed");
            }
        }
        catch (Exception ex)
        {
            if (silent) throw;
            Say("Setup failed:\n\n" + ex.Message, "Error", MessageBoxIcon.Error);
        }
    }

    private static void Install(bool autostart)
    {
        StopRunning();
        Directory.CreateDirectory(InstallDir);

        // The helper is carried inside this installer as a resource.
        using (var src = Assembly.GetExecutingAssembly().GetManifestResourceStream("helper.exe"))
        {
            if (src is null) throw new InvalidOperationException("helper.exe is missing from this installer.");
            using var dst = File.Create(HelperPath);
            src.CopyTo(dst);
        }

        // Keep a copy of the installer so the uninstall entry has something
        // to call once the download is long gone.
        try { File.Copy(Environment.ProcessPath!, SetupPath, true); } catch { }

        // The widget starts the helper through this scheme; the helper also
        // re-registers it on every launch, but the installer writes it so it
        // exists even if the first launch below is blocked.
        using (var k = Registry.CurrentUser.CreateSubKey(SchemeKey))
        {
            if (k is not null)
            {
                k.SetValue("", "URL:Twitchify Watch Sync");
                k.SetValue("URL Protocol", "");
                using var icon = k.CreateSubKey("DefaultIcon");
                icon?.SetValue("", "\"" + HelperPath + "\",0");
                using var cmd = k.CreateSubKey(@"shell\open\command");
                cmd?.SetValue("", "\"" + HelperPath + "\" \"%1\"");
            }
        }

        // Resident by default (asleep until iCUE runs); /noautostart opts out.
        if (autostart)
        {
            using var k = Registry.CurrentUser.CreateSubKey(RunKey);
            k?.SetValue(AppName, "\"" + HelperPath + "\"");
        }
        else
        {
            try { Registry.CurrentUser.OpenSubKey(RunKey, true)?.DeleteValue(AppName, false); } catch { }
        }

        using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            if (k is not null)
            {
                k.SetValue("DisplayName", DisplayName);
                k.SetValue("DisplayVersion", Version);
                k.SetValue("Publisher", "QAEM");
                k.SetValue("DisplayIcon", HelperPath);
                k.SetValue("InstallLocation", InstallDir);
                k.SetValue("UninstallString", "\"" + SetupPath + "\" /uninstall");
                k.SetValue("QuietUninstallString", "\"" + SetupPath + "\" /uninstall /silent");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        // A plain launch: the resident behaviour, the same as the Run entry
        // gives at logon. With /noautostart, launch as the widget would, so
        // it exits with iCUE instead of sleeping.
        Process.Start(new ProcessStartInfo(HelperPath, autostart ? "" : "twitchify-helper://start") { UseShellExecute = false });
    }

    private static void Uninstall()
    {
        StopRunning();

        try { Registry.CurrentUser.OpenSubKey(RunKey, true)?.DeleteValue(AppName, false); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(SchemeKey, false); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }

        try { if (File.Exists(HelperPath)) File.Delete(HelperPath); } catch { }
        try { Directory.Delete(InstallDir, true); } catch { }

        // The running installer can't delete itself; leave it for the OS.
        if (File.Exists(SetupPath) &&
            !string.Equals(Environment.ProcessPath, SetupPath, StringComparison.OrdinalIgnoreCase))
        {
            try { File.Delete(SetupPath); } catch { }
        }
    }

    private static void StopRunning()
    {
        foreach (var p in Process.GetProcessesByName("TwitchWatchHelper"))
        {
            try { p.Kill(); p.WaitForExit(4000); } catch { }
        }
        // Give Windows a moment to release the file handle.
        Thread.Sleep(300);
    }

    private static void Say(string text, string title, MessageBoxIcon icon = MessageBoxIcon.Information)
        => MessageBox.Show(text, "Twitchify Watch Sync — " + title, MessageBoxButtons.OK, icon);
}
