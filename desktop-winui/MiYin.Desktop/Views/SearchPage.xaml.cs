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

    public SearchPage()
    {
        InitializeComponent();
        foreach (var platform in Platforms)
            PlatformBox.Items.Add(new ComboBoxItem { Content = PlatformInfo.FullName(platform), Tag = platform });
        PlatformBox.SelectedIndex = 3;
        _ready = true;
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
        if (_loading) return;
        _loading = true;
        LoadingRing.IsActive = true;
        LoadMoreButton.IsEnabled = false;
        EmptyText.Visibility = Visibility.Collapsed;
        if (!append)
        {
            _page = 1;
            _songs.Clear();
            SummaryText.Text = "正在搜索…";
        }
        else
        {
            _page++;
        }

        try
        {
            var result = await ApiService.SearchAsync(_platform, keyword, _page, 30);
            _songs.AddRange(result.Result.List);
            Results.SetSongs(_songs);
            _hasMore = result.Result.HasMore;
            SummaryText.Text = $"{PlatformInfo.FullName(_platform)} · {keyword} · 共 {result.Result.Total} 首";
            LoadMoreButton.Visibility = _hasMore ? Visibility.Visible : Visibility.Collapsed;
            if (_songs.Count == 0)
            {
                EmptyText.Text = "没有找到相关歌曲，换个关键词试试";
                EmptyText.Visibility = Visibility.Visible;
            }
        }
        catch (Exception ex)
        {
            SummaryText.Text = "搜索失败：" + ex.Message;
            if (_songs.Count == 0)
            {
                EmptyText.Text = "搜索失败，请稍后重试";
                EmptyText.Visibility = Visibility.Visible;
            }
        }
        finally
        {
            _loading = false;
            LoadingRing.IsActive = false;
            LoadMoreButton.IsEnabled = true;
        }
    }
}
