using System.Collections.ObjectModel;
using System.Text.Json;
using MiYin.Desktop.Models;

namespace MiYin.Desktop.Services;

public sealed class LibraryService
{
    public static LibraryService Instance { get; } = new();

    private sealed class GuestLibrary
    {
        public List<FavoriteEntry> Favorites { get; set; } = new();
        public List<Playlist> Playlists { get; set; } = new();
        public List<HistoryEntry> History { get; set; } = new();
    }

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private GuestLibrary _guest = new();
    private bool _guestImported;
    private string? _visibleOwner;
    private int _reloadVersion;
    public bool IsOffline { get; private set; }
    private static string SnapshotPath(string owner) => Path.Combine(AppInfo.DataDirectory,
        "library-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(owner))) + ".json");

    public ObservableCollection<Song> Favorites { get; } = new();
    public ObservableCollection<Playlist> Playlists { get; } = new();
    public ObservableCollection<HistoryEntry> History { get; } = new();
    public ObservableCollection<SingerInfo> FavoriteSingers { get; } = new();

    public event EventHandler? Changed;
    public bool IsGuest => !AuthService.Instance.IsLoggedIn;

    public void Initialize()
    {
        LoadGuest();
    }

    public async Task ReloadAsync()
    {
        var version = ++_reloadVersion;
        var owner = AuthService.Instance.User?.Id;
        if (_visibleOwner != owner)
        {
            _visibleOwner = owner;
            if (owner is null) ApplyGuest();
            else
            {
                LibraryData? cached = null;
                try { cached = JsonSerializer.Deserialize<LibraryData>(File.ReadAllText(SnapshotPath(owner)), JsonOptions); } catch { }
                Apply(cached ?? new LibraryData());
                IsOffline = true;
            }
            Changed?.Invoke(this, EventArgs.Empty);
        }
        if (owner is not null)
        {
            try
            {
                var data = await ApiService.GetLibraryAsync();
                if (version != _reloadVersion || owner != AuthService.Instance.User?.Id) return;
                if (!_guestImported && IsLibraryEmpty(data) && !IsGuestEmpty())
                {
                    await ImportGuestAsync();
                    data = await ApiService.GetLibraryAsync();
                }
                if (version != _reloadVersion || owner != AuthService.Instance.User?.Id) return;
                IsOffline = false;
                Apply(data);
            }
            catch (Exception ex)
            {
                if (version != _reloadVersion || owner != AuthService.Instance.User?.Id) return;
                IsOffline = true;
                Notify.Show("云端音乐库暂不可用，保留此账号的本机快照：" + ex.Message, true);
            }
        }
        else
        {
            ApplyGuest();
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private static bool IsLibraryEmpty(LibraryData data) =>
        data.Favorites.Count == 0 && data.Playlists.Count == 0 && data.History.Count == 0;

    private bool IsGuestEmpty() =>
        _guest.Favorites.Count == 0 && _guest.Playlists.Count == 0 && _guest.History.Count == 0;

    private void Apply(LibraryData data)
    {
        FavoriteSingers.Clear();
        foreach (var singer in data.FavoriteSingers) FavoriteSingers.Add(singer);
        var owner = AuthService.Instance.User?.Id;
        if (owner is not null)
        {
            try
            {
                Directory.CreateDirectory(AppInfo.DataDirectory);
                var path = SnapshotPath(owner);
                File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(data, JsonOptions));
                File.Move(path + ".tmp", path, true);
            }
            catch { /* Keep the visible library if storage is temporarily unavailable. */ }
        }
        Favorites.Clear();
        foreach (var favorite in data.Favorites) Favorites.Add(favorite.Song);
        Playlists.Clear();
        foreach (var playlist in data.Playlists) Playlists.Add(playlist);
        History.Clear();
        foreach (var entry in data.History) History.Add(entry);
    }

    private void ApplyGuest()
    {
        FavoriteSingers.Clear();
        Favorites.Clear();
        foreach (var favorite in _guest.Favorites) Favorites.Add(favorite.Song);
        Playlists.Clear();
        foreach (var playlist in _guest.Playlists) Playlists.Add(playlist);
        History.Clear();
        foreach (var entry in _guest.History) History.Add(entry);
    }

    private void LoadGuest()
    {
        try
        {
            if (!File.Exists(AppInfo.GuestLibraryFile)) return;
            var json = File.ReadAllText(AppInfo.GuestLibraryFile);
            _guest = JsonSerializer.Deserialize<GuestLibrary>(json, JsonOptions) ?? new GuestLibrary();
        }
        catch
        {
            _guest = new GuestLibrary();
        }
    }

    private void SaveGuest()
    {
        try
        {
            Directory.CreateDirectory(AppInfo.DataDirectory);
            File.WriteAllText(AppInfo.GuestLibraryFile, JsonSerializer.Serialize(_guest, JsonOptions));
        }
        catch
        {
            /* ignore */
        }
    }

    private async Task ImportGuestAsync()
    {
        try
        {
            var data = await ApiService.ImportLibraryAsync(
                _guest.Favorites.Select(f => f.Song),
                _guest.Playlists,
                _guest.History.Select(h => h.Song));
            Apply(data);
            _guest = new GuestLibrary();
            SaveGuest();
            _guestImported = true;
            Notify.Show("已把本机收藏与歌单同步到账号");
        }
        catch (Exception ex)
        {
            Notify.Show("同步本机歌单失败：" + ex.Message, true);
        }
    }

    public bool IsFavorite(Song song)
    {
        var key = song.Key;
        return Favorites.Any(item => item.Key == key);
    }

    public async Task ToggleFavoriteAsync(Song song)
    {
        if (song.Platform == "local") { Notify.Show("本地文件保留在本地音乐库"); return; }
        var exists = IsFavorite(song);
        if (IsGuest)
        {
            if (exists) _guest.Favorites.RemoveAll(f => f.Song.Key == song.Key);
            else _guest.Favorites.Insert(0, new FavoriteEntry { Song = song, AddedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            SaveGuest();
            ApplyGuest();
            Changed?.Invoke(this, EventArgs.Empty);
            Notify.Show(exists ? "已取消收藏" : "已加入喜欢");
            return;
        }
        try
        {
            var data = exists
                ? await ApiService.RemoveFavoriteAsync(song.Key)
                : await ApiService.AddFavoriteAsync(song);
            Apply(data);
            Changed?.Invoke(this, EventArgs.Empty);
            Notify.Show(exists ? "已取消收藏" : "已加入喜欢");
        }
        catch (Exception ex)
        {
            Notify.Show((exists ? "取消收藏失败：" : "收藏失败：") + ex.Message, true);
        }
    }

    public void RecordPlay(Song song)
    {
        var existing = History.FirstOrDefault(entry => entry.Song.Key == song.Key);
        if (existing is not null) History.Remove(existing);
        History.Insert(0, new HistoryEntry { Song = song, PlayedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        while (History.Count > 200) History.RemoveAt(History.Count - 1);

        if (IsGuest)
        {
            _guest.History = History.Take(200).ToList();
            SaveGuest();
        }
        else
        {
            _ = ApiService.AddHistoryAsync(song).ContinueWith(task =>
            {
                if (task.IsFaulted) { /* 静默失败 */ }
            });
        }
    }

    public async Task ClearHistoryAsync()
    {
        History.Clear();
        if (IsGuest)
        {
            _guest.History.Clear();
            SaveGuest();
        }
        else
        {
            try
            {
                var data = await ApiService.ClearHistoryAsync();
                Apply(data);
            }
            catch (Exception ex)
            {
                Notify.Show("清空播放记录失败：" + ex.Message, true);
            }
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task<Playlist?> CreatePlaylistAsync(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0) return null;
        if (IsGuest)
        {
            var playlist = new Playlist
            {
                Id = "local_" + Guid.NewGuid().ToString("N")[..12],
                Name = trimmed,
                CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            _guest.Playlists.Insert(0, playlist);
            SaveGuest();
            ApplyGuest();
            Changed?.Invoke(this, EventArgs.Empty);
            return playlist;
        }
        try
        {
            var data = await ApiService.CreatePlaylistAsync(trimmed);
            Apply(data);
            Changed?.Invoke(this, EventArgs.Empty);
            return Playlists.FirstOrDefault();
        }
        catch (Exception ex)
        {
            Notify.Show("新建歌单失败：" + ex.Message, true);
            return null;
        }
    }

    public async Task RenamePlaylistAsync(Playlist playlist, string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0) return;
        if (IsGuest)
        {
            playlist.Name = trimmed;
            playlist.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            SaveGuest();
        }
        else
        {
            try
            {
                var data = await ApiService.UpdatePlaylistAsync(playlist.Id, trimmed);
                Apply(data);
            }
            catch (Exception ex)
            {
                Notify.Show("重命名失败：" + ex.Message, true);
            }
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task DeletePlaylistAsync(Playlist playlist)
    {
        if (IsGuest)
        {
            _guest.Playlists.RemoveAll(item => item.Id == playlist.Id);
            SaveGuest();
            ApplyGuest();
        }
        else
        {
            try
            {
                var data = await ApiService.DeletePlaylistAsync(playlist.Id);
                Apply(data);
            }
            catch (Exception ex)
            {
                Notify.Show("删除歌单失败：" + ex.Message, true);
            }
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task<bool> AddToPlaylistAsync(Playlist playlist, Song song)
    {
        if (playlist.Songs.Any(item => item.Key == song.Key))
        {
            Notify.Show("这首歌已经在歌单里了");
            return false;
        }
        if (IsGuest)
        {
            playlist.Songs.Add(song);
            playlist.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            SaveGuest();
            Notify.Show("已添加到《" + playlist.Name + "》");
            Changed?.Invoke(this, EventArgs.Empty);
            return true;
        }
        try
        {
            var data = await ApiService.AddPlaylistSongAsync(playlist.Id, song);
            Apply(data);
            Changed?.Invoke(this, EventArgs.Empty);
            Notify.Show("已添加到《" + playlist.Name + "》，服务端开始缓存");
            return true;
        }
        catch (Exception ex)
        {
            Notify.Show("添加失败：" + ex.Message, true);
            return false;
        }
    }

    public async Task RemoveFromPlaylistAsync(Playlist playlist, Song song)
    {
        if (IsGuest)
        {
            var item = playlist.Songs.FirstOrDefault(entry => entry.Key == song.Key);
            if (item is not null) playlist.Songs.Remove(item);
            SaveGuest();
        }
        else
        {
            try
            {
                var data = await ApiService.RemovePlaylistSongAsync(playlist.Id, song.Key);
                Apply(data);
            }
            catch (Exception ex)
            {
                Notify.Show("移除失败：" + ex.Message, true);
            }
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
