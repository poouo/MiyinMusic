using System.Text.Json;
using MiYin.Desktop.Models;

namespace MiYin.Desktop.Services;

public sealed class WindowPlacement
{
    public int Width { get; set; } = 1320;
    public int Height { get; set; } = 860;
    public int? X { get; set; }
    public int? Y { get; set; }
    public bool Maximized { get; set; }
}

public sealed class AppSettings
{
    public string ApiBase { get; set; } = "https://music.poouo.com";
    public string Token { get; set; } = "";
    public User? User { get; set; }
    public string Theme { get; set; } = "dark";
    public List<string> Quality { get; set; } = new() { "flac", "320k", "128k" };
    public double Volume { get; set; } = 0.75;
    public string CacheDir { get; set; } = "";
    public long CacheMaxBytes { get; set; } = 2L * 1024 * 1024 * 1024;
    public bool AutoCache { get; set; } = true;
    public string DownloadDir { get; set; } = "";
    public bool CloseToTray { get; set; } = true;
    public bool MinimizeToTray { get; set; } = false;
    public string Repeat { get; set; } = "all";
    public bool Shuffle { get; set; }
    public WindowPlacement Window { get; set; } = new();
}

public static class ConfigService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private static readonly object Gate = new();

    public static AppSettings Current { get; private set; } = new();

    public static string ConfigFile => Path.Combine(AppInfo.DataDirectory, "config.json");

    public static void Initialize()
    {
        Directory.CreateDirectory(AppInfo.DataDirectory);
        try
        {
            if (File.Exists(ConfigFile))
            {
                var json = File.ReadAllText(ConfigFile);
                var loaded = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
                if (loaded is not null) Current = loaded;
            }
        }
        catch
        {
            Current = new AppSettings();
        }

        // 正式版固定使用公网域名，客户端不提供服务器配置入口。
        // 开发调试时（Debug 构建）允许用环境变量指向本地服务。
        Current.ApiBase = "https://music.poouo.com";
#if DEBUG
        var envBase = Environment.GetEnvironmentVariable("MIYIN_API_BASE");
        if (!string.IsNullOrWhiteSpace(envBase))
        {
            Current.ApiBase = NormalizeBase(envBase);
        }
#endif
        if (string.IsNullOrWhiteSpace(Current.CacheDir)) Current.CacheDir = AppInfo.DefaultCacheDirectory;
        if (string.IsNullOrWhiteSpace(Current.DownloadDir)) Current.DownloadDir = AppInfo.DefaultDownloadDirectory;
        if (Current.CacheMaxBytes <= 0) Current.CacheMaxBytes = 2L * 1024 * 1024 * 1024;
        if (Current.Quality.Count == 0) Current.Quality = new List<string> { "flac", "320k", "128k" };
        Current.Volume = Math.Clamp(Current.Volume, 0, 1);
        Directory.CreateDirectory(Current.CacheDir);
        Directory.CreateDirectory(Current.DownloadDir);
        Save();
    }

    public static string NormalizeBase(string? input)
    {
        var text = (input ?? "").Trim();
        if (text.Length == 0) return "https://music.poouo.com";
        if (!text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !text.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            text = "https://" + text;
        }
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri)) return "https://music.poouo.com";
        if (uri.Scheme != "http" && uri.Scheme != "https") return "https://music.poouo.com";
        return uri.GetLeftPart(UriPartial.Authority);
    }

    public static void Save()
    {
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(AppInfo.DataDirectory);
                var json = JsonSerializer.Serialize(Current, JsonOptions);
                var temp = ConfigFile + ".tmp";
                File.WriteAllText(temp, json);
                File.Move(temp, ConfigFile, true);
            }
            catch
            {
                /* 忽略磁盘写入错误 */
            }
        }
    }

    public static void SetAuth(string token, User? user)
    {
        Current.Token = token;
        Current.User = user;
        Save();
    }

    public static void ClearAuth()
    {
        Current.Token = "";
        Current.User = null;
        Save();
    }

    public static void SetUser(User? user)
    {
        Current.User = user;
        Save();
    }

    public static void SetCacheRule(string dir, long maxBytes, bool autoCache)
    {
        if (!string.IsNullOrWhiteSpace(dir)) Current.CacheDir = dir;
        Current.CacheMaxBytes = Math.Clamp(maxBytes, 256L * 1024 * 1024, 100L * 1024 * 1024 * 1024);
        Current.AutoCache = autoCache;
        Directory.CreateDirectory(Current.CacheDir);
        Save();
    }

    public static void SetDownloadDir(string dir)
    {
        if (string.IsNullOrWhiteSpace(dir)) return;
        Current.DownloadDir = dir;
        Directory.CreateDirectory(Current.DownloadDir);
        Save();
    }

    public static void SetQuality(IEnumerable<string> qualities)
    {
        var list = qualities.Where(q => q is "128k" or "320k" or "flac" or "flac24bit").Distinct().ToList();
        if (list.Count > 0) Current.Quality = list;
        Save();
    }

    public static void SaveWindow(double width, double height, int? x, int? y, bool maximized)
    {
        Current.Window.Width = (int)Math.Max(900, width);
        Current.Window.Height = (int)Math.Max(600, height);
        Current.Window.X = x;
        Current.Window.Y = y;
        Current.Window.Maximized = maximized;
        Save();
    }
}
