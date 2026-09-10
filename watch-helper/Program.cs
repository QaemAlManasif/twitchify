using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TwitchWatchHelper;

// ══════════════════════════════════════════════════════════════════
// Twitchify — Watch Sync helper.
//
// Bridges the browser extension to the iCUE widget. The widget cannot
// listen on a port and an extension cannot be dialled into, so this sits
// between them: the extension POSTs the Twitch tabs it can see, the widget
// subscribes to a Server-Sent Events stream and receives them.
//
// Loopback only. Channel names are all that travel — no cookies, no page
// content, and no Twitch credentials: the widget owns the token.
//
// It runs with iCUE, the way Deckord's helper does. Windows has no "when
// iCUE launches" trigger without something already resident, so the exe
// is resident (a per-user Run entry, set by the installer) but asleep:
// no port, nothing to do, until iCUE.exe is running. Then it serves, page
// switches on the EDGE included, and when iCUE is gone it closes the port
// and sleeps again. The twitchify-helper:// URL scheme is the other way
// in — the widget opens it when watch sync is on and nothing answers, and
// the Preferences dialog has a button for it — and a helper started that
// way exits, rather than sleeps, once iCUE is gone.
// ══════════════════════════════════════════════════════════════════
internal static class Program
{
    private const int Port = 57123;
    private const string AppName = "TwitchWatchHelper";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Scheme = "twitchify-helper";
    private const string SchemeKey = @"Software\Classes\" + Scheme;
    private const string IcueProcess = "iCUE";

    // Whether the widget started us (through the scheme): then a stop is an
    // exit; a resident helper goes back to sleep instead.
    private static bool _onDemand;
    private static HttpListener? _listener;      // null while asleep

    private static readonly object Gate = new();
    private static readonly List<Subscriber> Subscribers = new();
    private static string _state = "{\"tabs\":[]}";

    // The extension re-syncs at least once a minute (an alarm covers the
    // idle service worker), so a silent 90s means it is gone, not quiet.
    private static DateTime _lastTabs = DateTime.MinValue;
    private static bool ExtensionUp()
    {
        lock (Gate) return (DateTime.UtcNow - _lastTabs) < TimeSpan.FromSeconds(90);
    }

    private sealed class Subscriber
    {
        public HttpListenerResponse Response = null!;
        public CancellationTokenSource Done = new();
    }

    [STAThread]
    private static void Main(string[] args)
    {
        // One helper per machine; a second launch just exits.
        using var single = new Mutex(true, @"Global\TwitchWatchHelper", out var owned);
        if (!owned) return;

        if (args.Contains("/uninstall", StringComparer.OrdinalIgnoreCase))
        {
            SetAutostart(false);
            SetScheme(false);
            return;
        }
        if (args.Contains("/register", StringComparer.OrdinalIgnoreCase))
        {
            SetScheme(true);
            return;
        }
        if (args.Contains("/autostart", StringComparer.OrdinalIgnoreCase)) SetAutostart(true);

        // Every launch (re)points the scheme at this exe, so the portable
        // route works after one manual start and a moved exe heals itself.
        SetScheme(true);

        _onDemand = args.Any(a => a.StartsWith(Scheme + ":", StringComparison.OrdinalIgnoreCase));
        Log("helper started" + (_onDemand ? " by the widget" : IsAutostart() ? " with Windows" : ""));

        // Comment frames keep idle streams alive and surface dead clients;
        // the same loop is the gate that decides when serving stops.
        var keepalive = new Thread(KeepaliveLoop) { IsBackground = true };
        keepalive.Start();

        while (true)
        {
            // Asleep until there is an iCUE to serve. A widget-launched
            // helper serves at once: in the browser preview there is no iCUE.
            if (!IcueRunning() && !_onDemand)
            {
                Thread.Sleep(5000);
                continue;
            }

            Serve();   // returns once iCUE is gone and no widget is attached

            if (!IsAutostart())
            {
                Log("iCUE is gone, exiting");
                return;
            }
            Log("iCUE is gone, sleeping");
            _onDemand = false;   // from here on we are the resident copy
        }
    }

    private static void Serve()
    {
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        try
        {
            listener.Start();
        }
        catch (Exception ex)
        {
            // Another copy holds the port (a portable one beside the
            // installed one, say). Try again in a while rather than die.
            Log("could not bind port " + Port + ": " + ex.Message);
            Thread.Sleep(30000);
            return;
        }
        _listener = listener;
        Log("serving on 127.0.0.1:" + Port);

        while (true)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); }
            catch (Exception ex)
            {
                if (_listener is not null) Log("listener stopped: " + ex.Message);
                break;
            }

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try { Handle(ctx); }
                catch (Exception ex) { Log("request failed: " + ex.Message); }
            });
        }
        _listener = null;
        try { listener.Close(); } catch { }
    }

    // Two misses in a row (30s), so an iCUE restart doesn't count, and a
    // connected widget always holds the port open.
    private static int _icueMissing;
    private static void GateTick()
    {
        var l = _listener;
        if (l is null) return;
        int clients;
        lock (Gate) clients = Subscribers.Count;
        _icueMissing = IcueRunning() ? 0 : _icueMissing + 1;
        if (_icueMissing < 2 || clients > 0) return;
        _icueMissing = 0;
        _listener = null;             // tells Serve() this stop is ours
        try { l.Stop(); } catch { }
    }

    // ── routing ───────────────────────────────────────────────────
    private static void Handle(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        Cors(res);

        if (req.HttpMethod == "OPTIONS")
        {
            // A JSON POST is not a "simple" request, so browsers preflight.
            res.StatusCode = 204;
            res.Close();
            return;
        }

        var path = req.Url?.AbsolutePath ?? "/";

        if (req.HttpMethod == "GET" && path.StartsWith("/health"))
        {
            int clients;
            lock (Gate) clients = Subscribers.Count;
            Json(res, $"{{\"ok\":true,\"clients\":{clients},\"extension\":{(ExtensionUp() ? "true" : "false")},\"autostart\":{(IsAutostart() ? "true" : "false")}}}");
            return;
        }

        if (req.HttpMethod == "GET" && path.StartsWith("/events")) { Events(ctx); return; }
        if (req.HttpMethod == "POST" && path.StartsWith("/tabs")) { Tabs(req, res); return; }
        if (req.HttpMethod == "POST" && path.StartsWith("/autostart")) { Autostart(req, res); return; }

        res.StatusCode = 404;
        Json(res, "{\"error\":\"not found\"}");
    }

    private static void Tabs(HttpListenerRequest req, HttpListenerResponse res)
    {
        string body;
        using (var reader = new StreamReader(req.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();

        JsonNode? parsed;
        try { parsed = JsonNode.Parse(body); }
        catch { res.StatusCode = 400; Json(res, "{\"error\":\"bad json\"}"); return; }

        var tabs = parsed?["tabs"]?.AsArray();
        if (tabs is null) { res.StatusCode = 400; Json(res, "{\"error\":\"tabs must be a list\"}"); return; }

        var clean = new JsonArray();
        foreach (var t in tabs.Take(50))
        {
            var login = t?["login"]?.GetValue<string>()?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(login)) continue;
            clean.Add((JsonNode)new JsonObject
            {
                ["login"] = login,
                ["title"] = Truncate(t?["title"]?.GetValue<string>() ?? "", 120),
                ["active"] = t?["active"]?.GetValue<bool>() ?? false,
                ["focused"] = t?["focused"]?.GetValue<bool>() ?? false,
            });
        }

        var state = new JsonObject { ["tabs"] = clean }.ToJsonString();
        lock (Gate) { _state = state; _lastTabs = DateTime.UtcNow; }
        Broadcast(state);

        Json(res, $"{{\"ok\":true,\"received\":{clean.Count}}}");
    }

    private static void Autostart(HttpListenerRequest req, HttpListenerResponse res)
    {
        string body;
        using (var reader = new StreamReader(req.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
        bool on;
        try { on = JsonNode.Parse(body)?["on"]?.GetValue<bool>() ?? false; }
        catch { res.StatusCode = 400; Json(res, "{\"error\":\"bad json\"}"); return; }

        SetAutostart(on);
        Json(res, $"{{\"ok\":true,\"autostart\":{(on ? "true" : "false")}}}");
    }

    private static void Events(HttpListenerContext ctx)
    {
        var res = ctx.Response;
        res.StatusCode = 200;
        res.ContentType = "text/event-stream";
        res.Headers["Cache-Control"] = "no-cache, no-store";
        res.SendChunked = true;
        res.KeepAlive = true;

        var sub = new Subscriber { Response = res };
        lock (Gate) Subscribers.Add(sub);

        string current;
        lock (Gate) current = _state;

        try
        {
            Write(res, "data: " + current + "\n\n");
            // Hold the connection open; the keepalive thread does the rest.
            sub.Done.Token.WaitHandle.WaitOne();
        }
        catch { /* client went away */ }
        finally
        {
            lock (Gate) Subscribers.Remove(sub);
            try { res.Close(); } catch { }
        }
    }

    // ── fan-out ───────────────────────────────────────────────────
    private static void Broadcast(string state)
    {
        var payload = "data: " + state + "\n\n";
        foreach (var sub in Snapshot())
        {
            if (!TryWrite(sub, payload)) Drop(sub);
        }
    }

    private static void KeepaliveLoop()
    {
        while (true)
        {
            Thread.Sleep(15000);
            foreach (var sub in Snapshot())
            {
                if (!TryWrite(sub, ": keepalive\n\n")) Drop(sub);
            }

            GateTick();
        }
    }

    private static bool IcueRunning()
    {
        try
        {
            var found = System.Diagnostics.Process.GetProcessesByName(IcueProcess);
            foreach (var p in found) p.Dispose();
            return found.Length > 0;
        }
        catch { return true; }   // can't tell — err on staying alive
    }

    private static List<Subscriber> Snapshot()
    {
        lock (Gate) return new List<Subscriber>(Subscribers);
    }

    private static bool TryWrite(Subscriber sub, string text)
    {
        try { Write(sub.Response, text); return true; }
        catch { return false; }
    }

    private static void Drop(Subscriber sub)
    {
        lock (Gate) Subscribers.Remove(sub);
        try { sub.Done.Cancel(); } catch { }
    }

    private static void Write(HttpListenerResponse res, string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        res.OutputStream.Write(bytes, 0, bytes.Length);
        res.OutputStream.Flush();
    }

    // ── helpers ───────────────────────────────────────────────────
    private static void Cors(HttpListenerResponse res)
    {
        res.Headers["Access-Control-Allow-Origin"] = "*";
        res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
        res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    }

    private static void Json(HttpListenerResponse res, string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        res.ContentType = "application/json";
        res.ContentLength64 = bytes.Length;
        try
        {
            res.OutputStream.Write(bytes, 0, bytes.Length);
            res.Close();
        }
        catch { }
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

    private static bool IsAutostart()
    {
        try
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey, false);
            return k?.GetValue(AppName) is not null;
        }
        catch { return false; }
    }

    // twitchify-helper://start → this exe. Per user, no elevation needed.
    private static void SetScheme(bool on)
    {
        try
        {
            if (!on)
            {
                Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(SchemeKey, false);
                return;
            }
            using var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(SchemeKey);
            if (k is null) return;
            k.SetValue("", "URL:Twitchify Watch Sync");
            k.SetValue("URL Protocol", "");
            using var icon = k.CreateSubKey("DefaultIcon");
            icon?.SetValue("", "\"" + Environment.ProcessPath + "\",0");
            using var cmd = k.CreateSubKey(@"shell\open\command");
            cmd?.SetValue("", "\"" + Environment.ProcessPath + "\" \"%1\"");
        }
        catch (Exception ex) { Log("scheme: " + ex); }
    }

    private static void SetAutostart(bool on)
    {
        try
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey, true)
                          ?? Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey);
            if (k is null) return;
            if (on) k.SetValue(AppName, "\"" + Environment.ProcessPath + "\"");
            else k.DeleteValue(AppName, false);
        }
        catch (Exception ex) { Log("autostart: " + ex.Message); }
    }

    private static void Log(string message)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TwitchModeration");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "helper.log"),
                DateTime.Now.ToString("s") + "  " + message + Environment.NewLine);
        }
        catch { }
    }
}
