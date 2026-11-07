using System.Collections.Concurrent;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace MiYin.Desktop.Services;

/// <summary>
/// 本地回环代理：MediaPlayer 不携带我们的 UA / 登录态，
/// 由这个 127.0.0.1 服务转发带签名地址，保证防盗链校验通过。
/// </summary>
public sealed class LocalMediaServer
{
    public static LocalMediaServer Instance { get; } = new();

    private readonly ConcurrentDictionary<string, Target> _targets = new();
    private static readonly HttpClient Client = CreateClient();
    private WebApplication? _app;

    public string BaseUrl { get; private set; } = "";
    public bool IsRunning => !string.IsNullOrEmpty(BaseUrl);

    private sealed record Target(string Url, bool SendAuth, DateTimeOffset Expire);

    private static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler
        {
            AutomaticDecompression = System.Net.DecompressionMethods.None,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            AllowAutoRedirect = true,
        };
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public async Task StartAsync()
    {
        if (_app is not null) return;
        try
        {
            var builder = WebApplication.CreateSlimBuilder();
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            var app = builder.Build();
            app.MapGet("/m/{id}", ProxyAsync);
            app.MapMethods("/m/{id}", new[] { "HEAD" }, ProxyAsync);
            await app.StartAsync();

            var server = app.Services.GetRequiredService<IServer>();
            var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses;
            var address = addresses?.FirstOrDefault() ?? "http://127.0.0.1:0";
            BaseUrl = address.TrimEnd('/');
            _app = app;
            AppLog.Write("local media server started at " + BaseUrl);
        }
        catch (Exception ex)
        {
            AppLog.Write("local media server failed: " + ex);
            BaseUrl = "";
        }
    }

    public async Task StopAsync()
    {
        if (_app is null) return;
        try
        {
            await _app.StopAsync(TimeSpan.FromSeconds(2));
            await _app.DisposeAsync();
        }
        catch
        {
            /* ignore */
        }
        _app = null;
        BaseUrl = "";
    }

    public string Register(string absoluteUrl)
    {
        if (string.IsNullOrWhiteSpace(absoluteUrl) || !IsRunning) return absoluteUrl;
        Purge();
        var id = Guid.NewGuid().ToString("N");
        var sendsAuth = absoluteUrl.StartsWith(ApiService.BaseUrl, StringComparison.OrdinalIgnoreCase);
        _targets[id] = new Target(absoluteUrl, sendsAuth, DateTimeOffset.UtcNow.AddHours(6));
        AppLog.Write("register proxy target=" + SafeUrl(absoluteUrl) + " auth=" + sendsAuth);
        return $"{BaseUrl}/m/{id}";
    }

    private static string SafeUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.GetLeftPart(UriPartial.Path) : url;

    private void Purge()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var pair in _targets)
        {
            if (pair.Value.Expire < now) _targets.TryRemove(pair.Key, out _);
        }
    }

    private async Task ProxyAsync(HttpContext context, string id)
    {
        if (!_targets.TryGetValue(id, out var target))
        {
            AppLog.Write("proxy unknown id=" + id);
            context.Response.StatusCode = 404;
            return;
        }
        try
        {
            using var request = new HttpRequestMessage(
                context.Request.Method.Equals("HEAD", StringComparison.OrdinalIgnoreCase) ? HttpMethod.Head : HttpMethod.Get,
                target.Url);
            request.Headers.TryAddWithoutValidation("User-Agent", AppInfo.UserAgent);
            request.Headers.TryAddWithoutValidation("Accept", "*/*");
            if (target.SendAuth && !string.IsNullOrEmpty(ConfigService.Current.Token))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ConfigService.Current.Token);
            }
            var range = context.Request.Headers.Range.ToString();
            if (!string.IsNullOrEmpty(range)) request.Headers.TryAddWithoutValidation("Range", range);

            using var response = await Client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                context.RequestAborted);

            context.Response.StatusCode = (int)response.StatusCode;
            var contentType = response.Content.Headers.ContentType?.ToString();
            if (!string.IsNullOrEmpty(contentType)) context.Response.ContentType = contentType;
            if (response.Content.Headers.ContentLength is long length) context.Response.ContentLength = length;
            AppLog.Write($"proxy {context.Request.Method} id={id} range={context.Request.Headers.Range} -> {(int)response.StatusCode} {contentType} len={response.Content.Headers.ContentLength}");
            CopyHeader(response, "Content-Range");
            CopyHeader(response, "Accept-Ranges");
            CopyHeader(response, "Cache-Control");
            CopyHeader(response, "Content-Disposition");
            CopyHeader(response, "ETag");

            if (context.Request.Method.Equals("HEAD", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }
            await using var stream = await response.Content.ReadAsStreamAsync(context.RequestAborted);
            await stream.CopyToAsync(context.Response.Body, context.RequestAborted);
        }
        catch (OperationCanceledException)
        {
            AppLog.Write("proxy canceled id=" + id);
        }
        catch (Exception ex)
        {
            AppLog.Write("proxy error id=" + id + " " + ex);
            if (!context.Response.HasStarted) context.Response.StatusCode = 502;
        }

        void CopyHeader(HttpResponseMessage source, string name)
        {
            if (source.Headers.TryGetValues(name, out var values) ||
                source.Content.Headers.TryGetValues(name, out values))
            {
                context.Response.Headers[name] = values.ToArray();
            }
        }
    }
}
