using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MiYin.Desktop.Models;

namespace MiYin.Desktop.Services;

public sealed class ApiException : Exception
{
    public int Status { get; }
    public string? Code { get; }

    public ApiException(int status, string message, string? code = null) : base(message)
    {
        Status = status;
        Code = code;
    }
}

public static class ApiService
{
    public static Task<AlbumDetail> GetAlbumAsync(string id) => SendAsync<AlbumDetail>(HttpMethod.Get, "/api/album/" + Uri.EscapeDataString(id));
    public static Task<Recommendations> GetRecommendationsAsync() => SendAsync<Recommendations>(HttpMethod.Get, "/api/discover/for-you");
    public static Task<SingerDetailResponse> GetSingerPageAsync(SingerInfo singer, int page) => SendAsync<SingerDetailResponse>(HttpMethod.Get, "/api/singer/" + Uri.EscapeDataString(singer.Id) + "?name=" + Uri.EscapeDataString(singer.Name) + "&page=" + page);
    public static async Task FollowSingerAsync(SingerInfo singer, bool remove) => _ = await SendAsync<LibraryResponse>(remove ? HttpMethod.Delete : HttpMethod.Post, "/api/library/singers" + (remove ? "/" + Uri.EscapeDataString(singer.Id) : ""), remove ? null : new { singer });
    public static Task<PlaylistDetailResponse> PreviewPlaylistAsync(string? link = null, string? id = null) =>
        SendAsync<PlaylistDetailResponse>(HttpMethod.Post, "/api/playlists/preview", new { link, id });
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly HttpClient Http = CreateClient(TimeSpan.FromSeconds(45));
    private static readonly Regex TokenRegex = new("miyin_token=([^;]+)", RegexOptions.Compiled);

    public static string BaseUrl => ConfigService.Current.ApiBase;
    public static string Token => ConfigService.Current.Token;

    private static HttpClient CreateClient(TimeSpan timeout)
    {
        var handler = new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            ConnectTimeout = TimeSpan.FromSeconds(12),
        };
        return new HttpClient(handler) { Timeout = timeout };
    }

    public static string AbsoluteUrl(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return path;
        }
        return BaseUrl + (path.StartsWith('/') ? path : "/" + path);
    }

    private static void CaptureToken(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out var cookies)) return;
        foreach (var cookie in cookies)
        {
            var match = TokenRegex.Match(cookie);
            if (!match.Success) continue;
            var token = Uri.UnescapeDataString(match.Groups[1].Value);
            if (!string.IsNullOrEmpty(token) && token != ConfigService.Current.Token)
            {
                ConfigService.Current.Token = token;
                ConfigService.Save();
            }
        }
    }

    private static ApiException CreateError(HttpStatusCode status, string text)
    {
        var message = string.IsNullOrWhiteSpace(text) ? $"请求失败（HTTP {(int)status}）" : text[..Math.Min(200, text.Length)];
        string? code = null;
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("error", out var error))
            {
                if (error.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String)
                    message = m.GetString() ?? message;
                if (error.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String)
                    code = c.GetString();
            }
        }
        catch
        {
            /* 非 JSON 错误体 */
        }
        return new ApiException((int)status, message, code);
    }

    private static async Task<T> SendAsync<T>(
        HttpMethod method,
        string path,
        object? body = null,
        bool auth = true,
        int timeoutMs = 40000)
    {
        using var cts = new CancellationTokenSource(timeoutMs);
        using var request = new HttpRequestMessage(method, BaseUrl + path);
        request.Headers.TryAddWithoutValidation("User-Agent", AppInfo.UserAgent);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        var token = ConfigService.Current.Token;
        if (auth && !string.IsNullOrEmpty(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        if (body is not null)
        {
            request.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json");
        }

        HttpResponseMessage response;
        string text;
        try
        {
            response = await Http.SendAsync(request, HttpCompletionOption.ResponseContentRead, cts.Token);
            text = await response.Content.ReadAsStringAsync(cts.Token);
        }
        catch (TaskCanceledException)
        {
            throw new ApiException(0, "请求超时，请检查网络或稍后重试", "timeout");
        }
        catch (HttpRequestException ex)
        {
            throw new ApiException(0, "无法连接服务器：" + FriendlyNetworkError(ex), "network");
        }

        using (response)
        {
            if (auth && !path.StartsWith("/api/auth/", StringComparison.Ordinal) && token != ConfigService.Current.Token)
                throw new OperationCanceledException("账号已切换，忽略旧账号请求结果");
            CaptureToken(response);
            if (!response.IsSuccessStatusCode) throw CreateError(response.StatusCode, text);
            if (string.IsNullOrWhiteSpace(text)) return default!;
            try
            {
                return JsonSerializer.Deserialize<T>(text, JsonOptions)
                       ?? throw new ApiException((int)response.StatusCode, "服务器返回了空数据");
            }
            catch (JsonException)
            {
                throw new ApiException((int)response.StatusCode, "服务器返回的数据格式不正确");
            }
        }
    }

    public static async Task<(bool ok, string message, string? version)> TestConnectionAsync(string baseUrl)
    {
        var normalized = ConfigService.NormalizeBase(baseUrl);
        try
        {
            using var client = CreateClient(TimeSpan.FromSeconds(9));
            using var response = await client.GetAsync(normalized + "/api/health");
            var text = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) return (false, $"服务返回 HTTP {(int)response.StatusCode}", null);
            var health = JsonSerializer.Deserialize<HealthResponse>(text, JsonOptions);
            return health?.Ok == true ? (true, "连接成功", health.Version) : (false, "服务响应异常", null);
        }
        catch (TaskCanceledException)
        {
            return (false, "连接超时，请检查 API 地址与网络", null);
        }
        catch (Exception ex)
        {
            return (false, FriendlyNetworkError(ex), null);
        }
    }

    private static string FriendlyNetworkError(Exception ex)
    {
        var inner = ex.GetBaseException();
        var message = inner.Message ?? "";
        if (message.Contains("SSL", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("certificate", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("TLS", StringComparison.OrdinalIgnoreCase))
        {
            return "SSL 连接失败，请检查服务器域名、证书或网络代理";
        }
        if (message.Contains("timed out", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("timeout", StringComparison.OrdinalIgnoreCase))
        {
            return "连接超时，请检查 API 地址与网络";
        }
        if (message.Contains("No such host", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("Name or service not known", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("nodename", StringComparison.OrdinalIgnoreCase))
        {
            return "无法解析服务器域名，请检查 API 地址或 DNS";
        }
        if (message.Contains("refused", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("拒绝", StringComparison.OrdinalIgnoreCase))
        {
            return "服务器拒绝连接，请确认服务端已启动";
        }
        return "无法连接服务器：" + message;
    }

    // ---------- 账号 ----------
    public static Task<MeResponse> MeAsync() => SendAsync<MeResponse>(HttpMethod.Get, "/api/auth/me");

    public static async Task<User> LoginAsync(string username, string password)
    {
        var result = await SendAsync<LoginResponse>(HttpMethod.Post, "/api/auth/login", new { username, password }, false, 20000);
        if (string.IsNullOrEmpty(ConfigService.Current.Token))
            throw new ApiException(401, "登录失败：服务器没有返回会话");
        ConfigService.SetAuth(ConfigService.Current.Token, result.User);
        return result.User;
    }

    public static async Task<User> RegisterAsync(string username, string password, string? nickname)
    {
        var result = await SendAsync<LoginResponse>(
            HttpMethod.Post,
            "/api/auth/register",
            new { username, password, nickname },
            false,
            20000);
        if (string.IsNullOrEmpty(ConfigService.Current.Token))
            throw new ApiException(401, "注册失败：服务器没有返回会话");
        ConfigService.SetAuth(ConfigService.Current.Token, result.User);
        return result.User;
    }

    public static async Task LogoutAsync()
    {
        try
        {
            await SendAsync<object>(HttpMethod.Post, "/api/auth/logout");
        }
        catch
        {
            /* 即使网络失败也清理本地登录态 */
        }
        ConfigService.ClearAuth();
    }

    public static async Task<User> UpdateProfileAsync(string nickname)
    {
        var result = await SendAsync<LoginResponse>(HttpMethod.Patch, "/api/auth/profile", new { nickname });
        ConfigService.SetUser(result.User);
        return result.User;
    }

    // ---------- 音乐库 ----------
    public static async Task<LibraryData> GetLibraryAsync() =>
        (await SendAsync<LibraryResponse>(HttpMethod.Get, "/api/library")).Library;

    public static async Task<LibraryData> AddFavoriteAsync(Song song) =>
        (await SendAsync<LibraryResponse>(HttpMethod.Post, "/api/library/favorites", new { song })).Library;

    public static async Task<LibraryData> RemoveFavoriteAsync(string songKey) =>
        (await SendAsync<LibraryResponse>(
            HttpMethod.Delete,
            "/api/library/favorites/" + Uri.EscapeDataString(songKey))).Library;

    public static async Task<LibraryData> AddHistoryAsync(Song song) =>
        (await SendAsync<LibraryResponse>(HttpMethod.Post, "/api/library/history", new { song })).Library;

    public static async Task<LibraryData> ClearHistoryAsync() =>
        (await SendAsync<LibraryResponse>(HttpMethod.Delete, "/api/library/history")).Library;

    public static async Task<LibraryData> CreatePlaylistAsync(string name, string description = "") =>
        (await SendAsync<LibraryResponse>(HttpMethod.Post, "/api/library/playlists", new { name, description })).Library;

    public static async Task<LibraryData> UpdatePlaylistAsync(string id, string name) =>
        (await SendAsync<LibraryResponse>(
            HttpMethod.Patch,
            "/api/library/playlists/" + Uri.EscapeDataString(id),
            new { name })).Library;

    public static async Task<LibraryData> DeletePlaylistAsync(string id) =>
        (await SendAsync<LibraryResponse>(
            HttpMethod.Delete,
            "/api/library/playlists/" + Uri.EscapeDataString(id))).Library;

    public static async Task<LibraryData> AddPlaylistSongAsync(string id, Song song) =>
        (await SendAsync<LibraryResponse>(
            HttpMethod.Post,
            "/api/library/playlists/" + Uri.EscapeDataString(id) + "/songs",
            new { song })).Library;

    public static async Task<LibraryData> RemovePlaylistSongAsync(string id, string songKey) =>
        (await SendAsync<LibraryResponse>(
            HttpMethod.Delete,
            "/api/library/playlists/" + Uri.EscapeDataString(id) + "/songs/" + Uri.EscapeDataString(songKey))).Library;

    public static async Task<LibraryData> ImportLibraryAsync(
        IEnumerable<Song> favorites,
        IEnumerable<Playlist> playlists,
        IEnumerable<Song> history)
    {
        var payload = new
        {
            favorites = favorites.ToList(),
            playlists = playlists.Select(p => new { name = p.Name, description = p.Description, songs = p.Songs.ToList() }).ToList(),
            history = history.ToList(),
        };
        return (await SendAsync<LibraryResponse>(HttpMethod.Post, "/api/library/import", payload, true, 60000)).Library;
    }

    // ---------- 内容 ----------
    public static Task<SearchResponse> SearchAsync(string platform, string keyword, int page = 1, int limit = 30) =>
        SendAsync<SearchResponse>(
            HttpMethod.Get,
            $"/api/search?platform={Uri.EscapeDataString(platform)}&q={Uri.EscapeDataString(keyword)}&page={page}&limit={limit}",
            auth: true);

    public static Task<ChartsResponse> GetChartsAsync() => SendAsync<ChartsResponse>(HttpMethod.Get, "/api/charts");

    public static Task<ChartSongsResponse> GetChartSongsAsync(string chartId, int limit = 100) =>
        SendAsync<ChartSongsResponse>(
            HttpMethod.Get,
            "/api/charts/" + Uri.EscapeDataString(chartId) + $"?limit={limit}&page=1");

    public static Task<DiscoverPlaylistsResponse> GetDiscoverPlaylistsAsync(int page = 1, int limit = 18, string? platform = null)
    {
        var query = $"?page={page}&limit={limit}";
        if (!string.IsNullOrWhiteSpace(platform) && platform != "all")
            query += "&platform=" + Uri.EscapeDataString(platform);
        return SendAsync<DiscoverPlaylistsResponse>(HttpMethod.Get, "/api/discover/playlists" + query);
    }

    public static Task<PlaylistDetailResponse> GetPlaylistAsync(string id, int offset = 0, int limit = 100) =>
        SendAsync<PlaylistDetailResponse>(
            HttpMethod.Get,
            "/api/playlist/" + Uri.EscapeDataString(id) + $"?offset={offset}&limit={limit}");

    public static Task<DiscoverSongsResponse> GetNewSongsAsync(int limit = 12) =>
        SendAsync<DiscoverSongsResponse>(HttpMethod.Get, $"/api/discover/new-songs?limit={limit}");

    public static Task<DiscoverSingersResponse> GetSingersAsync(int limit = 12) =>
        SendAsync<DiscoverSingersResponse>(HttpMethod.Get, $"/api/discover/singers?limit={limit}");

    public static Task<SingerDetailResponse> GetSingerAsync(string id, string name) =>
        SendAsync<SingerDetailResponse>(
            HttpMethod.Get,
            "/api/singer/" + Uri.EscapeDataString(id) + "?name=" + Uri.EscapeDataString(name));

    public static Task<LyricResponse> GetLyricAsync(Song song) =>
        SendAsync<LyricResponse>(HttpMethod.Post, "/api/lyric", new { song }, true, 25000);

    public static Task<ServerAppConfig> GetServerConfigAsync() =>
        SendAsync<ServerAppConfig>(HttpMethod.Get, "/api/config", auth: false);

    // ---------- 播放 / 下载 ----------
    public static Task<UrlResult> ResolveUrlAsync(Song song, IEnumerable<string> qualities) =>
        SendAsync<UrlResult>(
            HttpMethod.Post,
            "/api/url",
            new { song, qualities = qualities.ToList(), direct = true },
            true,
            35000);

    public static Task<DownloadMeta> GetDownloadInfoAsync(Song song) =>
        SendAsync<DownloadMeta>(HttpMethod.Post, "/api/download", new { song }, true, 45000);
}
