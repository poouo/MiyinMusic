using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class HomePage : Page
{
    private static List<PlaylistInfo>? _playlists;
    private static List<ChartInfo>? _charts;
    private static List<Song>? _newSongs;
    private static List<SingerInfo>? _singers;

    public HomePage()
    {
        InitializeComponent();
        Loaded += (_, _) => _ = LoadAsync();
        Unloaded += (_, _) => LibraryService.Instance.Changed -= Library_Changed;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        LibraryService.Instance.Changed += Library_Changed;
        RefreshRecent();
    }

    private void Library_Changed(object? sender, EventArgs e) => DispatcherQueue.TryEnqueue(RefreshRecent);

    private async Task LoadAsync()
    {
        LoadingRing.IsActive = true;
        ErrorText.Visibility = Visibility.Collapsed;
        try
        {
            if (_playlists is null || _charts is null || _newSongs is null || _singers is null)
            {
                var playlistsTask = ApiService.GetDiscoverPlaylistsAsync(12, 18);
                var chartsTask = ApiService.GetChartsAsync();
                var songsTask = ApiService.GetNewSongsAsync(12);
                var singersTask = ApiService.GetSingersAsync(12);
                await Task.WhenAll(playlistsTask, chartsTask, songsTask, singersTask);
                _playlists = playlistsTask.Result.Playlists;
                _charts = chartsTask.Result.Charts;
                _newSongs = songsTask.Result.Songs;
                _singers = singersTask.Result.Singers;
            }
            PlaylistRail.ItemsSource = _playlists;
            ChartRail.ItemsSource = MixCharts(_charts);
            NewSongRail.ItemsSource = _newSongs;
            SingerRail.ItemsSource = _singers;
        }
        catch (Exception ex)
        {
            ErrorText.Text = "内容加载失败：" + ex.Message;
            ErrorText.Visibility = Visibility.Visible;
        }
        finally
        {
            LoadingRing.IsActive = false;
        }
        RefreshRecent();
    }

    private static List<ChartInfo> MixCharts(List<ChartInfo> charts)
    {
        var groups = charts.GroupBy(chart => chart.Platform).Select(group => group.ToList()).ToList();
        var result = new List<ChartInfo>();
        for (var round = 0; round < 8 && result.Count < 12; round++)
        {
            foreach (var group in groups)
            {
                if (round < group.Count && result.Count < 12) result.Add(group[round]);
            }
        }
        return result;
    }

    private void RefreshRecent()
    {
        var songs = LibraryService.Instance.History.Take(6).Select(entry => entry.Song).ToList();
        RecentSection.Visibility = songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        RecentSongs.SetSongs(songs);
    }

    private void PlaylistRail_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is PlaylistInfo playlist)
            MainWindow.Instance.NavigateTo(typeof(SongsPage), playlist);
    }

    private void ChartRail_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is ChartInfo chart)
            MainWindow.Instance.NavigateTo(typeof(SongsPage), chart);
    }

    private void NewSongRail_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not Song song || _newSongs is null) return;
        var index = _newSongs.IndexOf(song);
        MediaService.Instance.PlaySongs(_newSongs, Math.Max(0, index));
    }

    private void SingerRail_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is SingerInfo singer)
            MainWindow.Instance.NavigateTo(typeof(SongsPage), singer);
    }

    private void PlayNewSongs_Click(object sender, RoutedEventArgs e)
    {
        if (_newSongs is { Count: > 0 }) MediaService.Instance.PlaySongs(_newSongs, 0);
    }

    private void OpenSquare_Click(object sender, RoutedEventArgs e) =>
        MainWindow.Instance.NavigateTo(typeof(SquarePage), null, "square");

    private void OpenCharts_Click(object sender, RoutedEventArgs e) =>
        MainWindow.Instance.NavigateTo(typeof(ChartsPage), null, "charts");

    private void OpenRecent_Click(object sender, RoutedEventArgs e) =>
        MainWindow.Instance.NavigateTo(typeof(LibraryPage), "recent", "recent");
}
