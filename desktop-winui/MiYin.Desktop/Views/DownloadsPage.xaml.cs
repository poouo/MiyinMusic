using System.Collections.Specialized;
using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class DownloadsPage : Page
{
    public DownloadsPage()
    {
        InitializeComponent();
        DownloadsItems.ItemsSource = DownloadService.Instance.Downloads;
        DownloadService.Instance.Downloads.CollectionChanged += Downloads_CollectionChanged;
        Unloaded += (_, _) => DownloadService.Instance.Downloads.CollectionChanged -= Downloads_CollectionChanged;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        UpdateState();
    }

    private void Downloads_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs e) => UpdateState();

    private void UpdateState()
    {
        var count = DownloadService.Instance.Downloads.Count;
        SubtitleText.Text = count > 0
            ? $"共 {count} 个任务 · 主动下载的文件永久保留，不受缓存容量限制"
            : "主动下载的文件永久保留，不受缓存容量限制";
        EmptyText.Visibility = count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e) => DownloadService.Instance.OpenFolder();

    private void ClearCompleted_Click(object sender, RoutedEventArgs e) => DownloadService.Instance.ClearCompleted();

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is DownloadItem item) DownloadService.Instance.Cancel(item);
    }

    private void Reveal_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is DownloadItem item) DownloadService.Instance.Reveal(item.Path);
    }
}
