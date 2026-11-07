using System.Collections.ObjectModel;
using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class SquarePage : Page
{
    private readonly ObservableCollection<PlaylistInfo> _items = new();
    private string _platform = "all";
    private int _page = 1;
    private bool _hasMore = true;
    private bool _loading;
    private bool _ready;

    public SquarePage()
    {
        InitializeComponent();
        PlaylistGrid.ItemsSource = _items;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (PlatformBox.Items.Count == 0)
        {
            PlatformBox.Items.Add(new ComboBoxItem { Content = "全部平台", Tag = "all" });
            PlatformBox.Items.Add(new ComboBoxItem { Content = "网易云音乐", Tag = "wy" });
            PlatformBox.Items.Add(new ComboBoxItem { Content = "QQ 音乐", Tag = "tx" });
            PlatformBox.SelectedIndex = 0;
            _ready = true;
        }
        _ = LoadPageAsync(true);
    }

    private void PlatformBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || PlatformBox.SelectedItem is not ComboBoxItem item) return;
        _platform = item.Tag as string ?? "all";
        _ = LoadPageAsync(true);
    }

    private async Task LoadPageAsync(bool reset)
    {
        if (_loading) return;
        _loading = true;
        LoadingRing.IsActive = true;
        LoadMoreButton.IsEnabled = false;
        if (reset)
        {
            _page = 1;
            _items.Clear();
            _hasMore = true;
        }
        try
        {
            var result = await ApiService.GetDiscoverPlaylistsAsync(_page, 24, _platform);
            foreach (var playlist in result.Playlists) _items.Add(playlist);
            _hasMore = result.HasMore;
            SubtitleText.Text = $"网易云音乐与 QQ 音乐精选歌单 · 已加载 {_items.Count} 个";
            LoadMoreButton.Visibility = _hasMore ? Visibility.Visible : Visibility.Collapsed;
            EmptyText.Visibility = _items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            EmptyText.Text = "暂时没有歌单，稍后再来看看";
        }
        catch (Exception ex)
        {
            SubtitleText.Text = "歌单加载失败：" + ex.Message;
            EmptyText.Text = "加载失败，请稍后重试";
            EmptyText.Visibility = Visibility.Visible;
        }
        finally
        {
            _loading = false;
            LoadingRing.IsActive = false;
            LoadMoreButton.IsEnabled = true;
        }
    }

    private void LoadMore_Click(object sender, RoutedEventArgs e)
    {
        if (!_hasMore) return;
        _page++;
        _ = LoadPageAsync(false);
    }

    private void PlaylistGrid_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is PlaylistInfo playlist)
            MainWindow.Instance.NavigateTo(typeof(SongsPage), playlist);
    }
}
