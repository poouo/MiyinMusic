using System.Collections.Concurrent;
using System.Text.Json;
using MiYin.Desktop.Models;

namespace MiYin.Desktop.Services;

public sealed class CacheEntry
{
    public string Path { get; set; } = "";
    public long Bytes { get; set; }
    public string Quality { get; set; } = "";
    public long LastAccess { get; set; }
    public long CreatedAt { get; set; }
}

/// <summary>客户端自动缓存：播放时把音频存到本地，容量超限按最久未播放清理。</summary>
public sealed class CacheService
{
    public static CacheService Instance { get; } = new();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };
    private readonly object _gate = new();
    private readonly Dictionary<string, CacheEntry> _index = new();
    private readonly ConcurrentDictionary<string, bool> _active = new();
    private readonly SemaphoreSlim _slots = new(2, 2);
    private static readonly HttpClient Http = CreateClient();
    private DateTime _lastSave = DateTime.MinValue;

    public event EventHandler? Changed;

    public string DirectoryPath => ConfigService.Current.CacheDir;
    public long MaxBytes => ConfigService.Current.CacheMaxBytes;
    public bool AutoCache => ConfigService.Current.AutoCache;

    private static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler { AutomaticDecompression = System.Net.DecompressionMethods.All };
        return new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(10) };
    }

    public void Initialize()
    {
        Directory.CreateDirectory(DirectoryPath);
        LoadIndex();
        lock (_gate)
        {
            var invalid = _index.Where(pair => !IsUsableAudio(pair.Value.Path)).Select(pair => pair.Key).ToList();
            foreach (var key in invalid)
            {
                if (_index.Remove(key, out var entry))
                {
                    try { if (File.Exists(entry.Path)) File.Delete(entry.Path); } catch { /* ignore */ }
                }
            }
            EnforceLimitNoLock();
        }
        SaveIndex(true);
    }

    private void LoadIndex()
    {
        try
        {
            if (!File.Exists(AppInfo.CacheIndexFile)) return;
            var json = File.ReadAllText(AppInfo.CacheIndexFile);
            var data = JsonSerializer.Deserialize<Dictionary<string, CacheEntry>>(json, JsonOptions);
            if (data is null) return;
            foreach (var pair in data)
            {
                if (pair.Value is not null && !string.IsNullOrWhiteSpace(pair.Value.Path))
                    _index[pair.Key] = pair.Value;
            }
        }
        catch
        {
            /* 索引损坏时重新开始 */
        }
    }

    private void SaveIndex(bool force = false)
    {
        if (!force && (DateTime.UtcNow - _lastSave).TotalSeconds < 3) return;
        _lastSave = DateTime.UtcNow;
        try
        {
            lock (_gate)
            {
                Directory.CreateDirectory(AppInfo.DataDirectory);
                var json = JsonSerializer.Serialize(_index, JsonOptions);
                File.WriteAllText(AppInfo.CacheIndexFile, json);
            }
        }
        catch
        {
            /* ignore */
        }
    }

    public bool TryGetLocalPath(string songKey, out string path, out string quality)
    {
        lock (_gate)
        {
            if (_index.TryGetValue(songKey, out var entry) && IsUsableAudio(entry.Path))
            {
                entry.LastAccess = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                path = entry.Path;
                quality = entry.Quality;
                SaveIndex();
                return true;
            }
            if (_index.Remove(songKey, out var stale))
            {
                try { if (File.Exists(stale.Path)) File.Delete(stale.Path); } catch { /* ignore */ }
                SaveIndex(true);
            }
            path = "";
            quality = "";
            return false;
        }
    }

    public bool Contains(string songKey)
    {
        lock (_gate)
        {
            return _index.TryGetValue(songKey, out var entry) && IsUsableAudio(entry.Path);
        }
    }

    /// <summary>后台缓存一首歌（sourceUrl 可以是本地代理地址）。</summary>
    public async Task EnsureAsync(Song song, string sourceUrl, string quality)
    {
        if (!AutoCache || string.IsNullOrWhiteSpace(sourceUrl)) return;
        if (Contains(song.Key)) return;
        if (!_active.TryAdd(song.Key, true)) return;
        await _slots.WaitAsync();
        try
        {
            if (Contains(song.Key)) return;
            Directory.CreateDirectory(DirectoryPath);
            var ext = quality.Contains("flac", StringComparison.OrdinalIgnoreCase) ? "flac" : "mp3";
            var safeKey = new string(song.Key.Select(c => char.IsLetterOrDigit(c) || c == '_' || c == '-' ? c : '_').ToArray());
            var fileName = $"{safeKey}_{quality}.{ext}";
            var finalPath = Path.Combine(DirectoryPath, fileName);
            if (File.Exists(finalPath))
            {
                if (IsUsableAudio(finalPath))
                {
                    var existing = new FileInfo(finalPath).Length;
                    lock (_gate)
                    {
                        _index[song.Key] = new CacheEntry
                        {
                            Path = finalPath,
                            Bytes = existing,
                            Quality = quality,
                            LastAccess = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                        };
                        EnforceLimitNoLock();
                    }
                    SaveIndex(true);
                    return;
                }
                try { File.Delete(finalPath); } catch { /* ignore */ }
            }

            var temp = finalPath + ".part";
            using var response = await Http.GetAsync(sourceUrl, HttpCompletionOption.ResponseHeadersRead);
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException("缓存下载失败 HTTP " + (int)response.StatusCode);
            var contentType = response.Content.Headers.ContentType?.MediaType ?? "";
            if (contentType.Contains("json") || contentType.Contains("html") || contentType.Contains("text/"))
                throw new InvalidOperationException("返回的不是音频");

            var total = response.Content.Headers.ContentLength ?? 0;
            await using var input = await response.Content.ReadAsStreamAsync();
            await using var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
            var buffer = new byte[81920];
            long received = 0;
            int read;
            while ((read = await input.ReadAsync(buffer)) > 0)
            {
                received += read;
                if (received > MaxBytes)
                {
                    output.Close();
                    File.Delete(temp);
                    return;
                }
                await output.WriteAsync(buffer.AsMemory(0, read));
            }
            await output.FlushAsync();
            output.Close();
            if (received <= 0)
            {
                File.Delete(temp);
                return;
            }
            if (total > 0 && received != total)
            {
                AppLog.Write($"cache incomplete {received}/{total} {song.Key}");
                File.Delete(temp);
                return;
            }
            if (!IsUsableAudio(temp))
            {
                AppLog.Write($"cache invalid audio {song.Key} bytes={received} type={contentType}");
                File.Delete(temp);
                return;
            }
            File.Move(temp, finalPath, true);
            lock (_gate)
            {
                _index[song.Key] = new CacheEntry
                {
                    Path = finalPath,
                    Bytes = received,
                    Quality = quality,
                    LastAccess = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                };
                EnforceLimitNoLock();
            }
            SaveIndex(true);
            Changed?.Invoke(this, EventArgs.Empty);
        }
        catch
        {
            /* 缓存失败不影响播放 */
        }
        finally
        {
            _active.TryRemove(song.Key, out _);
            _slots.Release();
        }
    }

    private void EnforceLimitNoLock()
    {
        var max = MaxBytes;
        var total = _index.Values.Sum(entry => entry.Bytes);
        if (total <= max) return;
        foreach (var pair in _index.OrderBy(pair => pair.Value.LastAccess).ToList())
        {
            if (total <= max) break;
            try
            {
                if (File.Exists(pair.Value.Path)) File.Delete(pair.Value.Path);
            }
            catch
            {
                /* 文件可能正在播放 */
            }
            total -= pair.Value.Bytes;
            _index.Remove(pair.Key);
        }
    }

    public void EnforceLimit()
    {
        lock (_gate) EnforceLimitNoLock();
        SaveIndex(true);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public (int count, long bytes, long maxBytes) Stats()
    {
        lock (_gate)
        {
            return (_index.Count, _index.Values.Sum(entry => entry.Bytes), MaxBytes);
        }
    }

    public bool Remove(string songKey)
    {
        var removed = false;
        lock (_gate)
        {
            if (_index.Remove(songKey, out var entry))
            {
                removed = true;
                try { if (File.Exists(entry.Path)) File.Delete(entry.Path); } catch { /* ignore */ }
                SaveIndex(true);
            }
        }
        if (removed) Changed?.Invoke(this, EventArgs.Empty);
        return removed;
    }

    private static bool IsUsableAudio(string path)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length < 8 * 1024) return false;
            Span<byte> header = stackalloc byte[12];
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var read = stream.Read(header);
            if (read < 8) return false;
            if (header[0] == 0x49 && header[1] == 0x44 && header[2] == 0x33) return true;
            if (header[0] == 0xFF && (header[1] & 0xE0) == 0xE0) return true;
            if (header[0] == 0x66 && header[1] == 0x4C && header[2] == 0x61 && header[3] == 0x43) return true;
            if (header[0] == 0x4F && header[1] == 0x67 && header[2] == 0x67 && header[3] == 0x53) return true;
            if (header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46) return true;
            if (header[4] == 0x66 && header[5] == 0x74 && header[6] == 0x79 && header[7] == 0x70) return true;
            return false;
        }
        catch
        {
            return false;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            foreach (var entry in _index.Values)
            {
                try
                {
                    if (File.Exists(entry.Path)) File.Delete(entry.Path);
                }
                catch
                {
                    /* ignore */
                }
            }
            _index.Clear();
        }
        SaveIndex(true);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public void SetDirectory(string dir)
    {
        if (string.IsNullOrWhiteSpace(dir)) return;
        lock (_gate)
        {
            _index.Clear();
        }
        ConfigService.Current.CacheDir = dir;
        Directory.CreateDirectory(dir);
        ConfigService.Save();
        SaveIndex(true);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public void SetMaxBytes(long bytes)
    {
        ConfigService.Current.CacheMaxBytes = Math.Clamp(bytes, 256L * 1024 * 1024, 100L * 1024 * 1024 * 1024);
        ConfigService.Save();
        EnforceLimit();
    }

    public void SetAutoCache(bool enabled)
    {
        ConfigService.Current.AutoCache = enabled;
        ConfigService.Save();
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
