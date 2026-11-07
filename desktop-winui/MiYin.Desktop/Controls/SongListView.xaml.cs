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
    public bool CanRemove { get; set; }

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
    private SongRow? _menuRow;

    public ObservableCollection<SongRow> Rows { get; } = new();
    public bool AllowRemove { get; set; }

    public event EventHandler<Song>? RemoveRequested;

    public SongListView()
    {
        InitializeComponent();
        Items.ItemsSource = Rows;
        LibraryService.Instance.Changed += (_, _) => RefreshFavorites();
    }

    public void SetSongs(IEnumerable<Song> songs, bool allowRemove = false)
    {
        AllowRemove = allowRemove;
        Rows.Clear();
        var index = 0;
        foreach (var song in songs)
        {
            var row = new SongRow(song, index++) { CanRemove = allowRemove };
            Rows.Add(row);
        }
    }

    public void RefreshFavorites()
    {
        foreach (var row in Rows)
        {
            row.IsFavorite = LibraryService.Instance.IsFavorite(row.Song);
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
        if (row is null) return;
        await LibraryService.Instance.ToggleFavoriteAsync(row.Song);
        row.IsFavorite = LibraryService.Instance.IsFavorite(row.Song);
    }

    private async void Add_Click(object sender, RoutedEventArgs e)
    {
        var row = RowOf(sender);
        if (row is null) return;
        await Dialogs.AddToPlaylistAsync(row.Song);
    }

    private async void Download_Click(object sender, RoutedEventArgs e)
    {
        var row = _menuRow ?? RowOf(sender);
        if (row is null) return;
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

