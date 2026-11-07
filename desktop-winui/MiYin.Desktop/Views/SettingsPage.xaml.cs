using System.Diagnostics;
using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using Windows.Storage.Pickers;

namespace MiYin.Desktop.Views;

public sealed partial class SettingsPage : Page
{
    private static readonly (string Label, string Quality)[] QualityOptions =
    {
        ("Hi-Res 无损", "flac24bit"),
        ("无损 SQ", "flac"),
        ("高品质 HQ", "320k"),
        ("标准音质", "128k"),
    };

    private static readonly (string Label, long Bytes)[] SizeOptions =
    {
        ("1 GB", 1L * 1024 * 1024 * 1024),
        ("2 GB", 2L * 1024 * 1024 * 1024),
        ("5 GB", 5L * 1024 * 1024 * 1024),
        ("10 GB", 10L * 1024 * 1024 * 1024),
        ("20 GB", 20L * 1024 * 1024 * 1024),
        ("50 GB", 50L * 1024 * 1024 * 1024),
    };

    private bool _ready;

    public SettingsPage()
    {
        InitializeComponent();
        Unloaded += (_, _) => CacheService.Instance.Changed -= Cache_Changed;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        CacheService.Instance.Changed += Cache_Changed;
        BuildOptions();
        Refresh();
    }

    private void Cache_Changed(object? sender, EventArgs e) => DispatcherQueue.TryEnqueue(UpdateCacheUsage);

    private void BuildOptions()
    {
        QualityBox.Items.Clear();
        foreach (var option in QualityOptions)
            QualityBox.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Quality });
        CacheSizeBox.Items.Clear();
        foreach (var option in SizeOptions)
            CacheSizeBox.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Bytes });
    }

    private void Refresh()
    {
        _ready = false;
        var theme = ConfigService.Current.Theme;
        ThemeBox.SelectedIndex = theme == "light" ? 1 : theme == "dark" ? 2 : 0;

        var user = AuthService.Instance.User;
        AccountNameText.Text = user is null ? "未登录" : user.Nickname;
        AccountRoleText.Text = user is null ? "登录后可同步收藏、歌单与播放记录" : $"{user.Username} · {user.RoleText}";
        LoginButton.Visibility = user is null ? Visibility.Visible : Visibility.Collapsed;
        NicknameButton.Visibility = user is null ? Visibility.Collapsed : Visibility.Visible;
        LogoutButton.Visibility = user is null ? Visibility.Collapsed : Visibility.Visible;
        AdminButton.Visibility = user?.Role == "admin" ? Visibility.Visible : Visibility.Collapsed;

        var preferred = ConfigService.Current.Quality.FirstOrDefault() ?? "320k";
        var index = Array.FindIndex(QualityOptions, option => option.Quality == preferred);
        QualityBox.SelectedIndex = index >= 0 ? index : 1;

        CachePathBox.Text = CacheService.Instance.DirectoryPath;
        var bytes = CacheService.Instance.MaxBytes;
        var sizeIndex = Array.FindIndex(SizeOptions, option => option.Bytes == bytes);
        CacheSizeBox.SelectedIndex = sizeIndex >= 0 ? sizeIndex : 1;
        AutoCacheSwitch.IsOn = CacheService.Instance.AutoCache;
        CloseToTraySwitch.IsOn = ConfigService.Current.CloseToTray;
        MinimizeToTraySwitch.IsOn = ConfigService.Current.MinimizeToTray;
        UpdateCacheUsage();

        DownloadPathBox.Text = ConfigService.Current.DownloadDir;
        AboutText.Text = $"觅音 Windows 客户端 v{AppInfo.Version}\n" +
                         $"API：{ConfigService.Current.ApiBase}\n" +
                         $"配置目录：{AppInfo.DataDirectory}\n" +
                         $"缓存目录：{CacheService.Instance.DirectoryPath}";
        _ready = true;
    }

    private void ThemeBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || ThemeBox.SelectedItem is not ComboBoxItem item || item.Tag is not string theme) return;
        ConfigService.Current.Theme = theme;
        ConfigService.Current.ThemeChosen = true;
        ConfigService.Save();
        MainWindow.Instance.ApplyTheme(theme);
    }

    private void UpdateCacheUsage()
    {
        var stats = CacheService.Instance.Stats();
        CacheUsageText.Text = $"已缓存 {stats.count} 首 · {FormatText.Bytes(stats.bytes)} / {FormatText.Bytes(stats.maxBytes)}";
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        await Dialogs.LoginAsync();
        Refresh();
    }

    private async void Logout_Click(object sender, RoutedEventArgs e)
    {
        if (!await Dialogs.ConfirmAsync("退出登录", "退出后将回到访客模式，本机收藏仍会保留在本地。")) return;
        await AuthService.Instance.LogoutAsync();
        Refresh();
        Notify.Show("已退出登录");
    }

    private async void Nickname_Click(object sender, RoutedEventArgs e)
    {
        var user = AuthService.Instance.User;
        if (user is null) return;
        var name = await Dialogs.PromptAsync("修改昵称", "新的昵称", user.Nickname, "保存");
        if (name is null) return;
        try
        {
            await AuthService.Instance.UpdateNicknameAsync(name);
            Refresh();
            Notify.Show("昵称已更新");
        }
        catch (Exception ex)
        {
            Notify.Show("修改昵称失败：" + ex.Message, true);
        }
    }

    private void QualityBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || QualityBox.SelectedItem is not ComboBoxItem item || item.Tag is not string quality) return;
        var list = new List<string> { quality };
        foreach (var existing in ConfigService.Current.Quality)
            if (!list.Contains(existing)) list.Add(existing);
        ConfigService.SetQuality(list);
        Notify.Show("优先音质已设置为 " + QualityOptions.FirstOrDefault(option => option.Quality == quality).Label);
    }

    private async void CacheBrowse_Click(object sender, RoutedEventArgs e)
    {
        var folder = await PickFolderAsync();
        if (folder is null) return;
        CacheService.Instance.SetDirectory(folder);
        Refresh();
        Notify.Show("缓存目录已更新");
    }

    private void CacheOpen_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(CacheService.Instance.DirectoryPath);
            Process.Start(new ProcessStartInfo("explorer.exe", CacheService.Instance.DirectoryPath) { UseShellExecute = true });
        }
        catch
        {
            Notify.Show("无法打开目录", true);
        }
    }

    private void CacheSize_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || CacheSizeBox.SelectedItem is not ComboBoxItem item || item.Tag is not long bytes) return;
        CacheService.Instance.SetMaxBytes(bytes);
        UpdateCacheUsage();
    }

    private void AutoCache_Toggled(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        CacheService.Instance.SetAutoCache(AutoCacheSwitch.IsOn);
    }

    private void CloseToTray_Toggled(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        ConfigService.Current.CloseToTray = CloseToTraySwitch.IsOn;
        ConfigService.Save();
    }

    private void MinimizeToTray_Toggled(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        ConfigService.Current.MinimizeToTray = MinimizeToTraySwitch.IsOn;
        ConfigService.Save();
    }

    private async void CacheClear_Click(object sender, RoutedEventArgs e)
    {
        if (!await Dialogs.ConfirmAsync("清空本地缓存", "确定清空自动缓存吗？主动下载的文件不会被删除。")) return;
        CacheService.Instance.Clear();
        UpdateCacheUsage();
        Notify.Show("本地缓存已清空");
    }

    private async void DownloadBrowse_Click(object sender, RoutedEventArgs e)
    {
        var folder = await PickFolderAsync();
        if (folder is null) return;
        ConfigService.SetDownloadDir(folder);
        Refresh();
        Notify.Show("下载目录已更新");
    }

    private void DownloadOpen_Click(object sender, RoutedEventArgs e) => DownloadService.Instance.OpenFolder();

    private void Admin_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo(ApiService.BaseUrl + "/#/admin") { UseShellExecute = true });
        }
        catch
        {
            Notify.Show("无法打开浏览器", true);
        }
    }

    private static async Task<string?> PickFolderAsync()
    {
        try
        {
            var picker = new FolderPicker();
            picker.FileTypeFilter.Add("*");
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(MainWindow.Instance);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
            var folder = await picker.PickSingleFolderAsync();
            return folder?.Path;
        }
        catch
        {
            return null;
        }
    }
}
