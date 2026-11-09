namespace MiYin.Desktop.Services;

public static class AppInfo
{
    public const string Name = "觅音";
    public const string Version = "1.0.0";
    public const string UserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "MiYinDesktop/1.0.0 Chrome/120.0.0.0 Safari/537.36";

    public static string DataDirectory
    {
        get
        {
#if DEBUG
            var testingDirectory = Environment.GetEnvironmentVariable("MIYIN_DESKTOP_DATA_DIR");
            if (!string.IsNullOrWhiteSpace(testingDirectory)) return Path.GetFullPath(testingDirectory);
#endif
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MiYin");
        }
    }

    public static string DefaultCacheDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiYin", "Cache");

    public static string DefaultDownloadDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "觅音");

    public static string GuestLibraryFile => Path.Combine(DataDirectory, "guest-library.json");
    public static string DownloadIndexFile => Path.Combine(DataDirectory, "downloads.json");
    public static string CacheIndexFile => Path.Combine(DataDirectory, "cache-index.json");
}
