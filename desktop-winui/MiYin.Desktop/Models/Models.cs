using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text.Json.Serialization;
using MiYin.Desktop.Services;

namespace MiYin.Desktop.Models;

public static class PlatformInfo
{
    private static readonly Dictionary<string, string> Names = new()
    {
        ["kw"] = "酷我",
        ["kg"] = "酷狗",
        ["tx"] = "QQ",
        ["wy"] = "网易云",
        ["mg"] = "咪咕",
    };

    public static string Name(string? platform) =>
        platform is not null && Names.TryGetValue(platform, out var name) ? name : "音乐";

    public static string FullName(string? platform) => platform switch
    {
        "kw" => "酷我音乐",
        "kg" => "酷狗音乐",
        "tx" => "QQ 音乐",
        "wy" => "网易云音乐",
        "mg" => "咪咕音乐",
        _ => "音乐",
    };
}

public static class FormatText
{
    public static string Duration(int seconds)
    {
        if (seconds <= 0) return "--:--";
        var time = TimeSpan.FromSeconds(seconds);
        return time.TotalHours >= 1
            ? $"{(int)time.TotalHours}:{time.Minutes:00}:{time.Seconds:00}"
            : $"{time.Minutes}:{time.Seconds:00}";
    }

    public static string Time(TimeSpan time)
    {
        if (time <= TimeSpan.Zero) return "00:00";
        return time.TotalHours >= 1
            ? $"{(int)time.TotalHours}:{time.Minutes:00}:{time.Seconds:00}"
            : $"{time.Minutes:00}:{time.Seconds:00}";
    }

    public static string Count(long value)
    {
        if (value >= 100_000_000) return (value / 100_000_000d).ToString("0.0") + " 亿";
        if (value >= 10_000) return (value / 10_000d).ToString("0.0") + " 万";
        return value.ToString();
    }

    public static string Bytes(long bytes)
    {
        if (bytes >= 1024L * 1024 * 1024) return (bytes / 1024d / 1024 / 1024).ToString("0.00") + " GB";
        if (bytes >= 1024 * 1024) return (bytes / 1024d / 1024).ToString("0.0") + " MB";
        if (bytes >= 1024) return (bytes / 1024d).ToString("0") + " KB";
        return bytes + " B";
    }
}

public sealed class Song
{
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("songmid")] public string SongMid { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("singer")] public string Singer { get; set; } = "";
    [JsonPropertyName("albumName")] public string AlbumName { get; set; } = "";
    [JsonPropertyName("interval")] public int Interval { get; set; }
    [JsonPropertyName("img")] public string? Img { get; set; }
    [JsonPropertyName("qualities")] public List<string> Qualities { get; set; } = new();
    [JsonPropertyName("hash")] public string? Hash { get; set; }
    [JsonPropertyName("albumId")] public string? AlbumId { get; set; }
    [JsonPropertyName("albumMid")] public string? AlbumMid { get; set; }
    [JsonPropertyName("strMediaMid")] public string? StrMediaMid { get; set; }
    [JsonPropertyName("copyrightId")] public string? CopyrightId { get; set; }
    [JsonPropertyName("songId")] public string? SongId { get; set; }
    [JsonPropertyName("lrcUrl")] public string? LrcUrl { get; set; }

    [JsonIgnore] public string Key => Platform + "_" + SongMid;
    [JsonIgnore] public string DurationText => FormatText.Duration(Interval);
    [JsonIgnore] public string PlatformText => PlatformInfo.Name(Platform);
    [JsonIgnore] public string CoverUrl => ApiService.AbsoluteUrl(Img);
    [JsonIgnore] public string SingerText => string.IsNullOrWhiteSpace(Singer) ? "未知歌手" : Singer;
    [JsonIgnore] public string QualityText
    {
        get
        {
            var best = Qualities.FirstOrDefault();
            return best switch
            {
                "flac24bit" => "Hi-Res",
                "flac" => "SQ",
                "320k" => "HQ",
                _ => "",
            };
        }
    }
}

public sealed class SearchResult
{
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("list")] public List<Song> List { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
    [JsonPropertyName("page")] public int Page { get; set; }
    [JsonPropertyName("limit")] public int Limit { get; set; }
    [JsonPropertyName("hasMore")] public bool HasMore { get; set; }
}

public sealed class ChartInfo
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("cover")] public string? Cover { get; set; }
    [JsonIgnore] public string PlatformText => PlatformInfo.Name(Platform);
    [JsonIgnore] public string CoverUrl => ApiService.AbsoluteUrl(Cover);
}

public sealed class PlaylistInfo
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("cover")] public string? Cover { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("creator")] public string? Creator { get; set; }
    [JsonPropertyName("tags")] public List<string>? Tags { get; set; }
    [JsonPropertyName("playCount")] public long PlayCount { get; set; }
    [JsonPropertyName("trackCount")] public int TrackCount { get; set; }

    [JsonIgnore] public string CoverUrl => ApiService.AbsoluteUrl(Cover);
    [JsonIgnore] public string PlayCountText => FormatText.Count(PlayCount);
    [JsonIgnore] public string PlatformText => PlatformInfo.Name(Platform);
    [JsonIgnore] public string MetaText => !string.IsNullOrWhiteSpace(Creator)
        ? Creator!
        : TrackCount > 0 ? TrackCount + " 首歌曲" : "精选歌单";
    [JsonIgnore] public string CountText => TrackCount > 0 ? TrackCount + " 首" : "";
}

public sealed class SingerInfo
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("pic")] public string? Pic { get; set; }
    [JsonPropertyName("followers")] public long Followers { get; set; }
    [JsonPropertyName("area")] public string? Area { get; set; }

    [JsonIgnore] public string PicUrl => ApiService.AbsoluteUrl(Pic);
    [JsonIgnore] public string FollowersText => Followers > 0 ? FormatText.Count(Followers) + " 粉丝" : Area ?? "热门歌手";
}

public sealed class User
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("nickname")] public string Nickname { get; set; } = "";
    [JsonPropertyName("avatarColor")] public string AvatarColor { get; set; } = "#7D8BFF";
    [JsonPropertyName("role")] public string Role { get; set; } = "user";
    [JsonPropertyName("status")] public string Status { get; set; } = "active";
    [JsonPropertyName("createdAt")] public long CreatedAt { get; set; }
    [JsonPropertyName("lastLoginAt")] public long? LastLoginAt { get; set; }

    [JsonIgnore] public string RoleText => Role switch
    {
        "admin" => "管理员",
        "vip" => "会员",
        _ => "普通用户",
    };
    [JsonIgnore] public string Initial => string.IsNullOrWhiteSpace(Nickname) ? "♪" : Nickname[..1];
}

public sealed class FavoriteEntry
{
    [JsonPropertyName("song")] public Song Song { get; set; } = new();
    [JsonPropertyName("addedAt")] public long AddedAt { get; set; }
}

public sealed class HistoryEntry
{
    [JsonPropertyName("song")] public Song Song { get; set; } = new();
    [JsonPropertyName("playedAt")] public long PlayedAt { get; set; }
}

public sealed class Playlist
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("songs")] public ObservableCollection<Song> Songs { get; set; } = new();
    [JsonPropertyName("createdAt")] public long CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public long UpdatedAt { get; set; }
    [JsonIgnore] public string CountText => Songs.Count + " 首";
    [JsonIgnore] public string CoverUrl => Songs.Count > 0 ? Songs[0].CoverUrl : "";
}

public sealed class LibraryData
{
    [JsonPropertyName("favorites")] public List<FavoriteEntry> Favorites { get; set; } = new();
    [JsonPropertyName("playlists")] public List<Playlist> Playlists { get; set; } = new();
    [JsonPropertyName("history")] public List<HistoryEntry> History { get; set; } = new();
    [JsonPropertyName("settings")] public System.Text.Json.JsonElement Settings { get; set; }
    [JsonPropertyName("updatedAt")] public long? UpdatedAt { get; set; }
}

public sealed class LyricResult
{
    [JsonPropertyName("lyric")] public string Lyric { get; set; } = "";
    [JsonPropertyName("tlyric")] public string? TLyric { get; set; }
    [JsonPropertyName("lxlyric")] public string? LxLyric { get; set; }
}

public sealed class LyricLine : INotifyPropertyChanged
{
    private bool _isActive;

    public TimeSpan Time { get; set; }
    public string Text { get; set; } = "";
    public string Translation { get; set; } = "";

    [JsonIgnore]
    public bool IsActive
    {
        get => _isActive;
        set
        {
            if (_isActive == value) return;
            _isActive = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsActive)));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}

public sealed class UrlResult
{
    [JsonPropertyName("playUrl")] public string PlayUrl { get; set; } = "";
    [JsonPropertyName("directUrl")] public string? DirectUrl { get; set; }
    [JsonPropertyName("quality")] public string Quality { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("cached")] public bool Cached { get; set; }
    [JsonPropertyName("sourceName")] public string? SourceName { get; set; }
}

public sealed class DownloadMeta
{
    [JsonPropertyName("url")] public string Url { get; set; } = "";
    [JsonPropertyName("quality")] public string Quality { get; set; } = "";
    [JsonPropertyName("filename")] public string Filename { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("cached")] public bool Cached { get; set; }
}

public sealed class DownloadPolicy
{
    [JsonPropertyName("enabled")] public bool Enabled { get; set; }
    [JsonPropertyName("roles")] public List<string> Roles { get; set; } = new();
    [JsonPropertyName("qualities")] public List<string> Qualities { get; set; } = new();
}

public sealed class PlatformOption
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("available")] public bool Available { get; set; }
}

public sealed class ServerAppConfig
{
    [JsonPropertyName("platforms")] public List<PlatformOption> Platforms { get; set; } = new();
    [JsonPropertyName("qualities")] public List<string> Qualities { get; set; } = new();
    [JsonPropertyName("allowRegister")] public bool AllowRegister { get; set; }
    [JsonPropertyName("download")] public DownloadPolicy Download { get; set; } = new();
}

// ---- API 响应包装 ----
public sealed class SearchResponse { [JsonPropertyName("result")] public SearchResult Result { get; set; } = new(); }
public sealed class ChartsResponse { [JsonPropertyName("charts")] public List<ChartInfo> Charts { get; set; } = new(); }
public sealed class ChartSongsResponse
{
    [JsonPropertyName("result")] public SearchResult Result { get; set; } = new();
    [JsonPropertyName("chart")] public ChartInfo? Chart { get; set; }
}
public sealed class DiscoverPlaylistsResponse
{
    [JsonPropertyName("playlists")] public List<PlaylistInfo> Playlists { get; set; } = new();
    [JsonPropertyName("page")] public int Page { get; set; }
    [JsonPropertyName("hasMore")] public bool HasMore { get; set; }
}
public sealed class PlaylistDetailResponse
{
    [JsonPropertyName("playlist")] public PlaylistInfo Playlist { get; set; } = new();
    [JsonPropertyName("songs")] public List<Song> Songs { get; set; } = new();
    [JsonPropertyName("total")] public int Total { get; set; }
    [JsonPropertyName("hasMore")] public bool HasMore { get; set; }
    [JsonPropertyName("offset")] public int Offset { get; set; }
}
public sealed class DiscoverSongsResponse { [JsonPropertyName("songs")] public List<Song> Songs { get; set; } = new(); }
public sealed class DiscoverSingersResponse { [JsonPropertyName("singers")] public List<SingerInfo> Singers { get; set; } = new(); }
public sealed class SingerDetailResponse
{
    [JsonPropertyName("singer")] public SingerInfo Singer { get; set; } = new();
    [JsonPropertyName("songs")] public List<Song> Songs { get; set; } = new();
}
public sealed class LibraryResponse { [JsonPropertyName("library")] public LibraryData Library { get; set; } = new(); }
public sealed class MeResponse
{
    [JsonPropertyName("user")] public User? User { get; set; }
    [JsonPropertyName("library")] public LibraryData? Library { get; set; }
}
public sealed class LoginResponse { [JsonPropertyName("user")] public User User { get; set; } = new(); }
public sealed class LyricResponse { [JsonPropertyName("lyric")] public LyricResult Lyric { get; set; } = new(); }
public sealed class HealthResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
}
