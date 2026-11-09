using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class SongsPage : Page
{
    private object? _parameter;
    private async void SavePlaylist_Click(object sender, RoutedEventArgs e)
    {
        if (_playlist is null) return;
        SavePlaylistButton.IsEnabled = false;
        try { await Dialogs.ImportPlaylistAsync(_playlist.Id); }
        finally { SavePlaylistButton.IsEnabled = true; }
    }
    private List<Song> _songs = new();
    private PlaylistInfo? _playlist;
    private int _offset;
    private SingerInfo? _singer;
    private int _singerPage = 1;
    private async void FollowSinger_Click(object sender, RoutedEventArgs e)
    {
        if (_singer is null) return;
        if (!AuthService.Instance.IsLoggedIn) { await Dialogs.LoginAsync(); return; }
        FollowButton.IsEnabled = false;
        try
        {
            await ApiService.FollowSingerAsync(_singer, LibraryService.Instance.FavoriteSingers.Any(item => item.Id == _singer.Id));
            await LibraryService.Instance.ReloadAsync(); RefreshFollow();
        }
        catch (Exception ex) { Notify.Show("关注失败：" + ex.Message, true); }
        finally { FollowButton.IsEnabled = true; }
    }
    private void RefreshFollow() => FollowButton.Content = LibraryService.Instance.FavoriteSingers.Any(item => item.Id == _singer?.Id) ? "取消关注" : "关注歌手";
    private bool _loadingMore;

    public SongsPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _parameter = e.Parameter;
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        _songs = new List<Song>();
        Songs.SetSongs(_songs);
        ErrorText.Visibility = Visibility.Collapsed;
        LoadMoreButton.Visibility = Visibility.Collapsed;
        PlayAllButton.IsEnabled = false;
        SavePlaylistButton.Visibility = Visibility.Collapsed;
        FollowButton.Visibility = Visibility.Collapsed;
        _singer = null; _playlist = null; _singerPage = 1;
        LoadingRing.IsActive = true;
        try
        {
            switch (_parameter)
            {
                case AlbumDetail album:
                    var detail = await ApiService.GetAlbumAsync(album.Id);
                    _songs = detail.Songs; Songs.SetSongs(_songs); PlayAllButton.IsEnabled = _songs.Count > 0;
                    SetHeader("专辑", detail.Name, detail.Singer + $" · {_songs.Count} 首", "", album.Id.StartsWith("wy-") ? "wy" : "tx", detail.Cover, false);
                    break;
                case string route when route == "for-you":
                    var recommendations = await ApiService.GetRecommendationsAsync();
                    _songs = recommendations.Items.Select(item => item.Song).ToList(); Songs.SetSongs(_songs); PlayAllButton.IsEnabled = _songs.Count > 0;
                    SetHeader("为你选歌", "从喜欢继续听", $"{_songs.Count} 首", string.Join("；", recommendations.Items.Select(item => item.Reason).Distinct()), "", _songs.FirstOrDefault()?.CoverUrl, false);
                    break;
                case ChartInfo chart:
                    await LoadChartAsync(chart);
                    break;
                case PlaylistInfo playlist:
                    await LoadPlaylistAsync(playlist);
                    break;
                case SingerInfo singer:
                    await LoadSingerAsync(singer);
                    break;
                default:
                    ErrorText.Text = "没有可显示的内容";
                    ErrorText.Visibility = Visibility.Visible;
                    break;
            }
        }
        catch (Exception ex)
        {
            ErrorText.Text = "加载失败：" + ex.Message;
            ErrorText.Visibility = Visibility.Visible;
        }
        finally
        {
            LoadingRing.IsActive = false;
        }
    }

    private async Task LoadChartAsync(ChartInfo chart)
    {
        var result = await ApiService.GetChartSongsAsync(chart.Id, 100);
        _songs = result.Result.List;
        SetHeader("排行榜", chart.Name, $"{PlatformInfo.Name(chart.Platform)} · {_songs.Count} 首", "", chart.Platform, chart.CoverUrl, false);
        Songs.SetSongs(_songs);
        PlayAllButton.IsEnabled = _songs.Count > 0;
    }

    private async Task LoadPlaylistAsync(PlaylistInfo playlist, bool append = false)
    {
        var result = await ApiService.GetPlaylistAsync(playlist.Id, append ? _offset : 0, 100);
        _playlist = result.Playlist;
        SavePlaylistButton.Visibility = Visibility.Visible;
        _offset = append ? _offset + result.Songs.Count : result.Songs.Count;
        if (append) _songs.AddRange(result.Songs);
        else _songs = result.Songs;
        var info = result.Playlist;
        var tags = info.Tags is { Count: > 0 } ? " · " + string.Join(" / ", info.Tags.Take(3)) : "";
        var meta = $"{PlatformInfo.Name(info.Platform)} · {info.Creator} · {info.TrackCount} 首 · {info.PlayCountText} 播放{tags}";
        SetHeader("歌单", info.Name, meta, info.Description ?? "", info.Platform, info.CoverUrl, false);
        Songs.SetSongs(_songs);
        LoadMoreButton.Visibility = result.HasMore ? Visibility.Visible : Visibility.Collapsed;
        PlayAllButton.IsEnabled = _songs.Count > 0;
    }

    private async Task LoadSingerAsync(SingerInfo singer)
    {
        var result = await ApiService.GetSingerAsync(singer.Id, singer.Name);
        _songs = result.Songs;
        var detail = result.Singer;
        _singer = detail; _singerPage = result.Page;
        FollowButton.Visibility = Visibility.Visible; RefreshFollow();
        LoadMoreButton.Visibility = result.HasMore ? Visibility.Visible : Visibility.Collapsed;
        SetHeader("歌手", detail.Name, $"{PlatformInfo.FullName(detail.Platform)} · 已加载 {_songs.Count} 首", result.Source == "catalog" ? "歌手作品" : "搜索到的歌曲", detail.Platform, detail.PicUrl, true);
        Songs.SetSongs(_songs);
        PlayAllButton.IsEnabled = _songs.Count > 0;
    }

    private void SetHeader(string kind, string title, string meta, string description, string platform, string? coverUrl, bool round)
    {
        KindText.Text = kind;
        TitleText.Text = title;
        MetaText.Text = meta;
        DescText.Text = description;
        DescText.Visibility = string.IsNullOrWhiteSpace(description) ? Visibility.Collapsed : Visibility.Visible;
        CoverRect.Width = round ? 160 : 170;
        CoverRect.Height = round ? 160 : 170;
        CoverRect.RadiusX = round ? 80 : 18;
        CoverRect.RadiusY = round ? 80 : 18;
        if (!string.IsNullOrWhiteSpace(coverUrl))
        {
            var bitmap = new BitmapImage();
            try
            {
                bitmap.UriSource = new Uri(coverUrl);
                bitmap.DecodePixelWidth = 420;
            }
            catch
            {
                /* ignore */
            }
            CoverRect.Fill = new ImageBrush { ImageSource = bitmap, Stretch = Stretch.UniformToFill };
        }
        else
        {
            var converter = Application.Current.Resources["PlatformBrush"] as IValueConverter;
            CoverRect.Fill = converter is null
                ? ThemeService.Brush("CardHoverBrush")
                : (Brush)converter.Convert(platform, typeof(Brush), null, "zh-CN");
        }
    }

    private void PlayAll_Click(object sender, RoutedEventArgs e)
    {
        if (_songs.Count > 0) MediaService.Instance.PlaySongs(_songs, 0);
    }

    private async void LoadMore_Click(object sender, RoutedEventArgs e)
    {
        if (!_loadingMore && _singer is not null)
        {
            _loadingMore = true; LoadMoreButton.IsEnabled = false;
            try
            {
                var result = await ApiService.GetSingerPageAsync(_singer, _singerPage + 1);
                var keys = _songs.Select(song => song.Key).ToHashSet(); _songs.AddRange(result.Songs.Where(song => keys.Add(song.Key)));
                _singerPage = result.Page; Songs.SetSongs(_songs); LoadMoreButton.Visibility = result.HasMore ? Visibility.Visible : Visibility.Collapsed;
                MetaText.Text = $"已加载 {_songs.Count} 首 · " + (result.Source == "catalog" ? "歌手作品" : "搜索到的歌曲");
            }
            catch (Exception ex) { Notify.Show("加载失败，可重试：" + ex.Message, true); }
            finally { _loadingMore = false; LoadMoreButton.IsEnabled = true; }
            return;
        }
        if (_loadingMore || _playlist is null) return;
        _loadingMore = true;
        LoadMoreButton.IsEnabled = false;
        try
        {
            await LoadPlaylistAsync(_playlist, true);
        }
        catch (Exception ex)
        {
            Notify.Show("加载更多失败：" + ex.Message, true);
        }
        finally
        {
            _loadingMore = false;
            LoadMoreButton.IsEnabled = true;
        }
    }
}

