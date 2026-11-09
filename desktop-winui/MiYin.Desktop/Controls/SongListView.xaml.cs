using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using MiYin.Desktop.Services;
using MiYin.Desktop.Models;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;

namespace MiYin.Desktop.Controls;

public sealed class SongRow : INotifyPropertyChanged
{
    public SongRow(Song song, int index)
    {
        Song = song;
        Index = index;
        _isFavorite = LibraryService.Instance.IsFavorite(song);
        HeartGlyph = _isFavorite ? "\uEB52" : "\uEB51";
    }

    public Song Song { get; }
    public int Index { get; }
    public int Number => Index + 1;
    public string IndexText => (Index + 1).ToString("00");
    public string Name => Song.Name;
    public string Singer => Song.SingerText;
    public string AlbumName => Song.AlbumName;
    public string DurationText => Song.DurationText;
    public string QualityText => Song.QualityText;
    public string CoverUrl => Song.CoverUrl;
    public string PlatformText => Song.PlatformText;
    public bool IsCloudSong => Song.Platform != "local";
    private bool _canRemove;
    public bool CanRemove { get => _canRemove; set { if (_canRemove == value) return; _canRemove = value; OnPropertyChanged(); } }

    private bool _isFavorite;
    public bool IsFavorite
    {
        get => _isFavorite;
        set
        {
            if (_isFavorite == value) return;
            _isFavorite = value;
            HeartGlyph = value ? "\uEB52" : "\uEB51";
            OnPropertyChanged();
            OnPropertyChanged(nameof(HeartGlyph));
        }
    }

    public string HeartGlyph { get; private set; }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public sealed partial class SongListView : UserControl
{
    private void Singer_Click(object sender, RoutedEventArgs e)
    {
        var song = _menuRow?.Song;
        var artist = song?.Artists.FirstOrDefault();
        if (song is null || artist is null) { Notify.Show("此歌曲未提供歌手 ID"); return; }
        MainWindow.Instance?.NavigateTo(typeof(MiYin.Desktop.Views.SongsPage), new SingerInfo { Id = song.Platform + "-" + artist.Id, Platform = song.Platform, Name = artist.Name });
    }
    private void Album_Click(object sender, RoutedEventArgs e)
    {
        var song = _menuRow?.Song;
        if (song is null || song.Platform is not ("tx" or "wy") || string.IsNullOrWhiteSpace(song.AlbumId)) { Notify.Show("此歌曲未提供可用的专辑 ID"); return; }
        MainWindow.Instance?.NavigateTo(typeof(MiYin.Desktop.Views.SongsPage), new AlbumDetail { Id = song.Platform + "-" + (song.AlbumMid ?? song.AlbumId) });
    }
    private SongRow? _menuRow;

    public ObservableCollection<SongRow> Rows { get; } = new();
    public bool AllowRemove { get; set; }

    public event EventHandler<Song>? RemoveRequested;

    public SongListView()
    {
        InitializeComponent();
        Items.ItemsSource = Rows;
        Loaded += (_, _) => { LibraryService.Instance.Changed -= LibraryChanged; LibraryService.Instance.Changed += LibraryChanged; RefreshFavorites(); };
        Unloaded += (_, _) => { LibraryService.Instance.Changed -= LibraryChanged; _menuRow = null; };
    }

    private void LibraryChanged(object? sender, EventArgs args) => RefreshFavorites();

    public void SetSongs(IEnumerable<Song> songs, bool allowRemove = false)
    {
        AllowRemove = allowRemove;
        var list = songs.ToList();
        if (list.Count < Rows.Count || Rows.Where((row, index) => row.Song.Key != list[index].Key || !ReferenceEquals(row.Song, list[index])).Any()) Rows.Clear();
        foreach (var row in Rows) row.CanRemove = allowRemove;
        for (var index = Rows.Count; index < list.Count; index++)
        {
            var row = new SongRow(list[index], index) { CanRemove = allowRemove };
            Rows.Add(row);
        }
    }

    public void RefreshFavorites()
    {
        var favorites = LibraryService.Instance.Favorites.Select(song => song.Key).ToHashSet();
        foreach (var row in Rows)
        {
            row.IsFavorite = favorites.Contains(row.Song.Key);
            row.CanRemove = AllowRemove;
        }
    }

    private static SongRow? RowOf(object sender) => (sender as FrameworkElement)?.DataContext as SongRow;

    private void Row_PointerEntered(object sender, PointerRoutedEventArgs e)
    {
        if (sender is Grid grid) grid.Background = ThemeService.Brush("RowHoverBrush");
    }

    private void Row_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (sender is Grid grid) grid.Background = new SolidColorBrush(Colors.Transparent);
    }

    private void Row_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        var row = RowOf(sender);
        if (row is null) return;
        var index = Rows.IndexOf(row);
        MediaService.Instance.PlaySongs(Rows.Select(item => item.Song), index);
    }

    private void CoverPlay_Click(object sender, RoutedEventArgs e)
    {
        var row = RowOf(sender);
        if (row is null) return;
        MediaService.Instance.PlaySongs(Rows.Select(item => item.Song), Rows.IndexOf(row));
    }

    private void Play_Click(object sender, RoutedEventArgs e)
    {
        var row = RowOf(sender);
        if (row is null) return;
        MediaService.Instance.PlaySongs(Rows.Select(item => item.Song), Rows.IndexOf(row));
    }

    private async void Favorite_Click(object sender, RoutedEventArgs e)
    {
        var row = RowOf(sender);
        if (row is null || !row.IsCloudSong) return;
        await LibraryService.Instance.ToggleFavoriteAsync(row.Song);
        row.IsFavorite = LibraryService.Instance.IsFavorite(row.Song);
    }

    private async void Add_Click(object sender, RoutedEventArgs e)
    {
        var row = RowOf(sender);
        if (row is null || !row.IsCloudSong) return;
        await Dialogs.AddToPlaylistAsync(row.Song);
    }

    private async void Download_Click(object sender, RoutedEventArgs e)
    {
        var row = _menuRow ?? RowOf(sender);
        if (row is null || !row.IsCloudSong) return;
        if (!AuthService.Instance.CanDownload)
        {
            Notify.Show("当前账号没有下载权限，或管理员已关闭下载", true);
            return;
        }
        await DownloadService.Instance.StartAsync(row.Song);
    }

    private void More_Click(object sender, RoutedEventArgs e)
    {
        _menuRow = RowOf(sender);
        if (sender is Button button && button.Flyout is MenuFlyout flyout)
        {
            flyout.ShowAt(button);
        }
    }

    private void PlayNext_Click(object sender, RoutedEventArgs e)
    {
        if (_menuRow is null) return;
        MediaService.Instance.AddToQueue(_menuRow.Song, true);
    }

    private void QueueEnd_Click(object sender, RoutedEventArgs e)
    {
        if (_menuRow is null) return;
        MediaService.Instance.AddToQueue(_menuRow.Song, false);
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        if (_menuRow is null) return;
        var package = new DataPackage();
        package.SetText(_menuRow.Song.Name + " - " + _menuRow.Song.Singer);
        Clipboard.SetContent(package);
        Notify.Show("已复制歌名");
    }

    private void Remove_Click(object sender, RoutedEventArgs e)
    {
        if (_menuRow is null) return;
        RemoveRequested?.Invoke(this, _menuRow.Song);
    }
}

