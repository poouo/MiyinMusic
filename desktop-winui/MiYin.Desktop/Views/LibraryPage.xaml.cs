using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class LibraryPage : Page
{
    private enum Mode { Liked, Recent, Playlist }

    private Mode _mode = Mode.Liked;
    private string? _playlistId;
    private readonly List<Song> _songs = new();

    public LibraryPage()
    {
        InitializeComponent();
        Songs.RemoveRequested += Songs_RemoveRequested;
        Unloaded += (_, _) => LibraryService.Instance.Changed -= Library_Changed;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        LibraryService.Instance.Changed += Library_Changed;
        if (e.Parameter is string mode && mode == "recent")
        {
            _mode = Mode.Recent;
        }
        else if (e.Parameter is Playlist playlist)
        {
            _mode = Mode.Playlist;
            _playlistId = playlist.Id;
        }
        else
        {
            _mode = Mode.Liked;
        }
        Refresh();
    }

    private void Library_Changed(object? sender, EventArgs e) => DispatcherQueue.TryEnqueue(Refresh);

    private void Refresh()
    {
        _songs.Clear();
        string kind;
        string title;
        string subtitle;
        string emptyText;
        string cover;
        var allowRemove = false;
        RenameButton.Visibility = Visibility.Collapsed;
        DeleteButton.Visibility = Visibility.Collapsed;
        ClearButton.Visibility = Visibility.Collapsed;

        switch (_mode)
        {
            case Mode.Liked:
                _songs.AddRange(LibraryService.Instance.Favorites);
                kind = "我的喜欢";
                title = "我的喜欢";
                subtitle = _songs.Count + " 首歌曲 · 收藏会同步到账号";
                emptyText = "还没有喜欢的歌，点歌曲右侧的爱心收藏吧";
                cover = _songs.FirstOrDefault()?.CoverUrl ?? "";
                break;
            case Mode.Recent:
                _songs.AddRange(LibraryService.Instance.History.Select(entry => entry.Song));
                kind = "播放记录";
                title = "最近播放";
                subtitle = _songs.Count + " 首歌曲 · 最多保留 200 首";
                emptyText = "还没有播放记录，去发现页听一首歌吧";
                cover = _songs.FirstOrDefault()?.CoverUrl ?? "";
                ClearButton.Visibility = _songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
                break;
            default:
                var playlist = LibraryService.Instance.Playlists.FirstOrDefault(item => item.Id == _playlistId);
                if (playlist is null)
                {
                    KindText.Text = "歌单";
                    TitleText.Text = "歌单不存在";
                    SubtitleText.Text = "它可能已经被删除了";
                    EmptyText.Text = "返回发现页重新选择一个歌单";
                    EmptyText.Visibility = Visibility.Visible;
                    Songs.SetSongs(Array.Empty<Song>());
                    PlayAllButton.IsEnabled = false;
                    return;
                }
                _songs.AddRange(playlist.Songs);
                kind = "歌单";
                title = playlist.Name;
                subtitle = $"{_songs.Count} 首歌曲 · 服务端会自动缓存歌单里的歌曲";
                emptyText = "歌单还是空的，在歌曲右侧点 + 添加";
                cover = playlist.Songs.FirstOrDefault()?.CoverUrl ?? "";
                allowRemove = true;
                RenameButton.Visibility = Visibility.Visible;
                DeleteButton.Visibility = Visibility.Visible;
                break;
        }

        KindText.Text = kind;
        TitleText.Text = title;
        SubtitleText.Text = subtitle;
        EmptyText.Text = emptyText;
        EmptyText.Visibility = _songs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        Songs.Visibility = _songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        PlayAllButton.IsEnabled = _songs.Count > 0;
        Songs.SetSongs(_songs, allowRemove);
        SetCover(cover);
    }

    private void SetCover(string? url)
    {
        CoverIcon.Visibility = string.IsNullOrWhiteSpace(url) ? Visibility.Visible : Visibility.Collapsed;
        if (!string.IsNullOrWhiteSpace(url))
        {
            var bitmap = new BitmapImage();
            try
            {
                bitmap.UriSource = new Uri(url);
                bitmap.DecodePixelWidth = 360;
            }
            catch
            {
                /* ignore */
            }
            CoverRect.Fill = new ImageBrush { ImageSource = bitmap, Stretch = Stretch.UniformToFill };
            return;
        }
        CoverRect.Fill = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = Windows.UI.Color.FromArgb(255, 35, 90, 70), Offset = 0 },
                new GradientStop { Color = Windows.UI.Color.FromArgb(255, 21, 36, 48), Offset = 1 },
            },
        };
    }

    private void PlayAll_Click(object sender, RoutedEventArgs e)
    {
        if (_songs.Count > 0) MediaService.Instance.PlaySongs(_songs, 0);
    }

    private async void Clear_Click(object sender, RoutedEventArgs e)
    {
        if (!await Dialogs.ConfirmAsync("清空播放记录", "确定清空所有播放记录吗？")) return;
        await LibraryService.Instance.ClearHistoryAsync();
        Refresh();
    }

    private async void Rename_Click(object sender, RoutedEventArgs e)
    {
        var playlist = LibraryService.Instance.Playlists.FirstOrDefault(item => item.Id == _playlistId);
        if (playlist is null) return;
        var name = await Dialogs.PromptAsync("重命名歌单", "歌单名称", playlist.Name);
        if (name is null) return;
        await LibraryService.Instance.RenamePlaylistAsync(playlist, name);
        Refresh();
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        var playlist = LibraryService.Instance.Playlists.FirstOrDefault(item => item.Id == _playlistId);
        if (playlist is null) return;
        if (!await Dialogs.ConfirmAsync("删除歌单", $"确定删除《{playlist.Name}》吗？此操作不可恢复。")) return;
        await LibraryService.Instance.DeletePlaylistAsync(playlist);
        MainWindow.Instance.NavigateTo(typeof(HomePage), null, "home");
    }

    private async void Songs_RemoveRequested(object? sender, Song song)
    {
        var playlist = LibraryService.Instance.Playlists.FirstOrDefault(item => item.Id == _playlistId);
        if (playlist is null) return;
        await LibraryService.Instance.RemoveFromPlaylistAsync(playlist, song);
        Refresh();
    }
}
