using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Diagnostics;
using MiYin.Desktop.Models;

namespace MiYin.Desktop.Services;

public sealed class DownloadItem : INotifyPropertyChanged
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public Song Song { get; init; } = new();
    public string Quality { get; set; } = "";
    public string Title => Song.Name;
    public string Singer => Song.SingerText;
    public string CoverUrl => Song.CoverUrl;

    private string _status = "准备中";
    public string Status
    {
        get => _status;
        set { _status = value; OnPropertyChanged(); OnPropertyChanged(nameof(IsRunning)); }
    }

    private double _progress;
    public double Progress
    {
        get => _progress;
        set { _progress = value; OnPropertyChanged(); }
    }

    private string _received = "";
    public string ReceivedText
    {
        get => _received;
        set { _received = value; OnPropertyChanged(); }
    }

    private string _path = "";
    public string Path
    {
        get => _path;
        set { _path = value; OnPropertyChanged(); }
    }

    private string _error = "";
    public string Error
    {
        get => _error;
        set { _error = value; OnPropertyChanged(); }
    }

    public bool IsRunning => _status is "准备中" or "下载中";
    public bool IsDone => _status == "已完成";
    public bool IsFailed => _status == "失败";

    internal CancellationTokenSource? Cancellation { get; set; }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public sealed class DownloadIndexEntry
{
    public string Path { get; set; } = "";
    public long Bytes { get; set; }
    public long CreatedAt { get; set; }
}

public sealed class DownloadService
{
    public static DownloadService Instance { get; } = new();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };
    private static readonly HttpClient Http = CreateClient();
    private readonly Dictionary<string, DownloadIndexEntry> _index = new();
    private readonly object _gate = new();

    public ObservableCollection<DownloadItem> Downloads { get; } = new();

    private static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler { AutomaticDecompression = System.Net.DecompressionMethods.All };
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public void Initialize()
    {
        Directory.CreateDirectory(ConfigService.Current.DownloadDir);
        try
        {
            if (!File.Exists(AppInfo.DownloadIndexFile)) return;
            var json = File.ReadAllText(AppInfo.DownloadIndexFile);
            var data = JsonSerializer.Deserialize<Dictionary<string, DownloadIndexEntry>>(json, JsonOptions);
            if (data is null) return;
            foreach (var pair in data)
            {
                if (pair.Value is not null && File.Exists(pair.Value.Path))
                    _index[pair.Key] = pair.Value;
            }
        }
        catch
        {
            /* ignore */
        }
    }

    private void SaveIndex()
    {
        try
        {
            lock (_gate)
            {
                Directory.CreateDirectory(AppInfo.DataDirectory);
                File.WriteAllText(AppInfo.DownloadIndexFile, JsonSerializer.Serialize(_index, JsonOptions));
            }
        }
        catch
        {
            /* ignore */
        }
    }

    public bool TryGetDownloadPath(string songKey, out string path)
    {
        lock (_gate)
        {
            if (_index.TryGetValue(songKey, out var entry) && File.Exists(entry.Path))
            {
                path = entry.Path;
                return true;
            }
        }
        path = "";
        return false;
    }

    public async Task<DownloadItem> StartAsync(Song song)
    {
        var item = new DownloadItem { Song = song };
        Downloads.Insert(0, item);
        item.Status = "准备中";
        try
        {
            var meta = await ApiService.GetDownloadInfoAsync(song);
            item.Quality = meta.Quality;
            var dir = ConfigService.Current.DownloadDir;
            Directory.CreateDirectory(dir);
            var fileName = SanitizeFileName(meta.Filename);
            var path = UniquePath(Path.Combine(dir, fileName));
            item.Path = path;
            item.Status = "下载中";

            var cts = new CancellationTokenSource();
            item.Cancellation = cts;
            using var request = new HttpRequestMessage(HttpMethod.Get, ApiService.AbsoluteUrl(meta.Url));
            request.Headers.TryAddWithoutValidation("User-Agent", AppInfo.UserAgent);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("*/*"));
            if (!string.IsNullOrEmpty(ConfigService.Current.Token))
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ConfigService.Current.Token);

            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!response.IsSuccessStatusCode)
            {
                throw new ApiException((int)response.StatusCode, "下载失败 HTTP " + (int)response.StatusCode);
            }
            var total = response.Content.Headers.ContentLength ?? 0;
            var temp = path + ".part";
            long received = 0;
            await using (var input = await response.Content.ReadAsStreamAsync(cts.Token))
            await using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
            {
                var buffer = new byte[81920];
                var lastUpdate = DateTime.UtcNow;
                int read;
                while ((read = await input.ReadAsync(buffer, cts.Token)) > 0)
                {
                    received += read;
                    await output.WriteAsync(buffer.AsMemory(0, read), cts.Token);
                    if ((DateTime.UtcNow - lastUpdate).TotalMilliseconds > 180)
                    {
                        lastUpdate = DateTime.UtcNow;
                        UpdateProgress(item, received, total);
                    }
                }
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(temp, path);
            UpdateProgress(item, received, total);
            item.Status = "已完成";
            item.ReceivedText = FormatText.Bytes(received);
            lock (_gate)
            {
                _index[song.Key] = new DownloadIndexEntry
                {
                    Path = path,
                    Bytes = received,
                    CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                };
            }
            SaveIndex();
            Notify.Show("已下载：" + song.Name);
        }
        catch (OperationCanceledException)
        {
            item.Status = "已取消";
            CleanupPart(item);
        }
        catch (Exception ex)
        {
            item.Status = "失败";
            item.Error = ex.Message;
            Notify.Show("下载失败：" + ex.Message, true);
        }
        return item;
    }

    private static void UpdateProgress(DownloadItem item, long received, long total)
    {
        item.ReceivedText = total > 0
            ? FormatText.Bytes(received) + " / " + FormatText.Bytes(total)
            : FormatText.Bytes(received);
        item.Progress = total > 0 ? Math.Min(100, received * 100d / total) : 0;
    }

    private static void CleanupPart(DownloadItem item)
    {
        try
        {
            var part = item.Path + ".part";
            if (File.Exists(part)) File.Delete(part);
        }
        catch
        {
            /* ignore */
        }
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Trim();
        if (cleaned.Length > 120) cleaned = cleaned[..120];
        return string.IsNullOrWhiteSpace(cleaned) ? "music.mp3" : cleaned;
    }

    private static string UniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        var dir = Path.GetDirectoryName(path) ?? "";
        var name = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        for (var i = 1; i < 1000; i++)
        {
            var candidate = Path.Combine(dir, $"{name} ({i}){ext}");
            if (!File.Exists(candidate)) return candidate;
        }
        return path;
    }

    public void Cancel(DownloadItem item)
    {
        try
        {
            item.Cancellation?.Cancel();
        }
        catch
        {
            /* ignore */
        }
    }

    public void Reveal(string path)
    {
        try
        {
            if (File.Exists(path))
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
            else if (Directory.Exists(ConfigService.Current.DownloadDir))
                Process.Start(new ProcessStartInfo("explorer.exe", ConfigService.Current.DownloadDir) { UseShellExecute = true });
        }
        catch
        {
            /* ignore */
        }
    }

    public void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(ConfigService.Current.DownloadDir);
            Process.Start(new ProcessStartInfo("explorer.exe", ConfigService.Current.DownloadDir) { UseShellExecute = true });
        }
        catch
        {
            /* ignore */
        }
    }

    public void ClearCompleted()
    {
        for (var i = Downloads.Count - 1; i >= 0; i--)
        {
            if (!Downloads[i].IsRunning) Downloads.RemoveAt(i);
        }
    }
}
