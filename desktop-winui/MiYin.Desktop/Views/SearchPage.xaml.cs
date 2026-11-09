using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class SearchPage : Page
{
    private static readonly string[] Platforms = { "kw", "kg", "tx", "wy", "mg" };
    private readonly List<Song> _songs = new();
    private string _platform = "wy";
    private int _page = 1;
    private bool _hasMore;
    private bool _loading;
    private bool _ready;
    private int _requestVersion;
    private string _activeKeyword = "";
    private string _activePlatform = "";

    public SearchPage()
    {
        InitializeComponent();
        foreach (var platform in Platforms)
            PlatformBox.Items.Add(new ComboBoxItem { Content = PlatformInfo.FullName(platform), Tag = platform });
        PlatformBox.SelectedIndex = 3;
        _ready = true;
        Unloaded += (_, _) => { _requestVersion++; _loading = false; };
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (e.Parameter is string query && !string.IsNullOrWhiteSpace(query))
        {
            SearchBox.Text = query;
            _ = SearchAsync(false);
        }
        else
        {
            EmptyText.Text = "输入关键词，搜索五大平台的歌曲";
            EmptyText.Visibility = Visibility.Visible;
        }
    }

    private void PlatformBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || PlatformBox.SelectedItem is not ComboBoxItem item) return;
        _platform = item.Tag as string ?? "wy";
        if (!string.IsNullOrWhiteSpace(SearchBox.Text)) _ = SearchAsync(false);
    }

    private void SearchBox_QuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args) =>
        _ = SearchAsync(false);

    private void SearchBox_TextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args) =>
        sender.ItemsSource = ConfigService.Current.SearchHistory.Where(item => item.Contains(sender.Text, StringComparison.OrdinalIgnoreCase)).Take(10).ToList();

    private void ClearSearchHistory_Click(object sender, RoutedEventArgs e)
    {
        ConfigService.Current.SearchHistory.Clear(); ConfigService.Save(); SearchBox.ItemsSource = null;
    }

    private void Search_Click(object sender, RoutedEventArgs e) => _ = SearchAsync(false);

    private void LoadMore_Click(object sender, RoutedEventArgs e)
    {
        if (_hasMore) _ = SearchAsync(true);
    }

    private async Task SearchAsync(bool append)
    {
        var keyword = SearchBox.Text.Trim();
        if (keyword.Length == 0)
        {
            SummaryText.Text = "输入关键词开始搜索";
            return;
        }
        if (append && (_loading || keyword != _activeKeyword || _platform != _activePlatform)) return;
        var version = ++_requestVersion;
        var platform = _platform;
        var targetPage = append ? _page + 1 : 1;
        _activeKeyword = keyword;
        _activePlatform = platform;
        _loading = true;
        LoadingRing.IsActive = true;
        LoadMoreButton.IsEnabled = false;
        EmptyText.Visibility = Visibility.Collapsed;
        if (!append)
        {
            ConfigService.Current.SearchHistory.Remove(keyword);
            ConfigService.Current.SearchHistory.Insert(0, keyword);
            ConfigService.Current.SearchHistory = ConfigService.Current.SearchHistory.Take(20).ToList();
            ConfigService.Save();
            _page = 1;
            _songs.Clear();
            Results.SetSongs(_songs);
            _hasMore = false;
            LoadMoreButton.Visibility = Visibility.Collapsed;
            SummaryText.Text = "正在搜索…";
        }

        try
        {
            var result = await ApiService.SearchAsync(platform, keyword, targetPage, 30);
            if (version != _requestVersion) return;
            _page = targetPage;
            var keys = _songs.Select(song => song.Key).ToHashSet();
            _songs.AddRange(result.Result.List.Where(song => keys.Add(song.Key)));
            Results.SetSongs(_songs);
            _hasMore = result.Result.HasMore;
            SummaryText.Text = $"{PlatformInfo.FullName(platform)} · {keyword} · 共 {result.Result.Total} 首";
            LoadMoreButton.Visibility = _hasMore ? Visibility.Visible : Visibility.Collapsed;
            if (_songs.Count == 0)
            {
                EmptyText.Text = "没有找到相关歌曲，换个关键词试试";
                EmptyText.Visibility = Visibility.Visible;
            }
        }
        catch (Exception ex)
        {
            if (version != _requestVersion) return;
            SummaryText.Text = "搜索失败：" + ex.Message;
            if (_songs.Count == 0)
            {
                EmptyText.Text = "搜索失败，请稍后重试";
                EmptyText.Visibility = Visibility.Visible;
            }
        }
        finally
        {
            if (version == _requestVersion)
            {
                _loading = false;
                LoadingRing.IsActive = false;
                LoadMoreButton.IsEnabled = true;
            }
        }
    }
}
