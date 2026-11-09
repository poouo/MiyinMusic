using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using MiYin.Desktop.Views;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.Foundation;
using Windows.Graphics;

namespace MiYin.Desktop;

public sealed partial class MainWindow : Window
{
    public static MainWindow Instance { get; private set; } = null!;

    public MediaService Player => MediaService.Instance;

    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _toastTimer;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _playerInfoTimer;
    private readonly PlayerInfoIdleState _playerInfoIdle = new();
    private readonly long _idleClock = Stopwatch.GetTimestamp();
    private bool _volumeOpen;
    private readonly PlayerInfoIdleState _focusIdle = new(TimeSpan.FromSeconds(8));
    private bool _focusMode;
    private bool _updatingProgress;
    private bool _updatingVolume;
    private bool _draggingProgress;
    private bool _draggingVolume;
    private bool _initializing;
    private bool _retryScheduled;
    private bool _authPending;
    private bool _exiting;
    private bool _hidingToTray;

    public MainWindow()
    {
        InitializeComponent();
        Instance = this;
        Root.DataContext = this;
        ApplyTheme(ConfigService.Current.Theme);
        Root.ActualThemeChanged += (_, _) => SyncActualTheme();
        ConfigureWindow();
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        WindowIcon.Apply(hwnd);
        TrayIcon.Instance.Initialize(hwnd);
        AppWindow.Closing += AppWindow_Closing;
        AppWindow.Changed += AppWindow_Changed;
        Activated += MainWindow_Activated;

        _toastTimer = DispatcherQueue.CreateTimer();
        _toastTimer.Interval = TimeSpan.FromSeconds(3.4);
        _toastTimer.IsRepeating = false;
        _toastTimer.Tick += (_, _) => ToastBar.IsOpen = false;
        _playerInfoTimer = DispatcherQueue.CreateTimer();
        _playerInfoTimer.Interval = TimeSpan.FromMilliseconds(200);
        _playerInfoTimer.Tick += (_, _) => UpdatePlayerInfoMode();
        Root.AddHandler(UIElement.PointerEnteredEvent, new PointerEventHandler(Root_PointerActivity), true);
        Root.AddHandler(UIElement.PointerMovedEvent, new PointerEventHandler(Root_PointerActivity), true);
        Root.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(Root_KeyActivity), true);
        VolumeFlyoutContent.DataContext = this;

        SidebarPlaylists.ItemsSource = LibraryService.Instance.Playlists;
        QueueList.ItemsSource = Player.Queue;
        LyricsList.ItemsSource = Player.Lyrics;
        Player.Lyrics.CollectionChanged += (_, _) =>
        {
            UpdateLyricsEmptyState();
            UpdateLyricSelection();
        };

        Player.PropertyChanged += Player_PropertyChanged;
        Player.Queue.CollectionChanged += (_, _) => UpdateQueueState();
        AuthService.Instance.Changed += (_, _) => RefreshUserCard();
        LibraryService.Instance.Changed += (_, _) => RefreshUserCard();
        Notify.Shown += ShowToast;
        DesktopLyrics.Instance.Changed += (_, _) => UpdateDesktopLyricsButtons();

        ProgressSlider.PointerPressed += (_, _) => _draggingProgress = true;
        ProgressSlider.PointerReleased += (_, _) => _draggingProgress = false;
        ProgressSlider.PointerCaptureLost += (_, _) => _draggingProgress = false;
        VolumeSlider.PointerPressed += (_, _) => _draggingVolume = true;
        VolumeSlider.PointerReleased += (_, _) => _draggingVolume = false;
        VolumeSlider.PointerCaptureLost += (_, _) => _draggingVolume = false;

        Closed += MainWindow_Closed;
        RefreshUserCard();
        UpdateQueueState();
        UpdateHeartIcon();
        UpdateDesktopLyricsButtons();
        UpdateLyricsEmptyState();
        TrayIcon.Instance.UpdateTooltip("觅音");
        VolumeSlider.Value = Player.Volume;
        UpdateVolumeUI();
        ApplySidebar();
        _playerInfoTimer.Start();
    }

    private void MainWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        WindowIcon.Apply(WinRT.Interop.WindowNative.GetWindowHandle(this));
    }

    private void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_exiting || !ConfigService.Current.CloseToTray) return;
        args.Cancel = true;
        HideToTray();
    }

    private void AppWindow_Changed(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (_exiting || _hidingToTray || !ConfigService.Current.MinimizeToTray) return;
        if (sender.Presenter is not OverlappedPresenter presenter || presenter.State != OverlappedPresenterState.Minimized) return;
        _hidingToTray = true;
        DispatcherQueue.TryEnqueue(async () =>
        {
            await Task.Delay(150);
            if (!_exiting && sender.Presenter is OverlappedPresenter current && current.State == OverlappedPresenterState.Minimized)
            {
                HideToTray();
            }
            _hidingToTray = false;
        });
    }

    public void HideToTray()
    {
        AppWindow.Hide();
    }

    public void ShowFromTray()
    {
        if (AppWindow.Presenter is OverlappedPresenter presenter && presenter.State == OverlappedPresenterState.Minimized)
        {
            presenter.Restore();
        }
        AppWindow.Show();
        Activate();
        try
        {
            SetForegroundWindow(WinRT.Interop.WindowNative.GetWindowHandle(this));
        }
        catch
        {
            /* ignore */
        }
    }

    public void RequestExit()
    {
        _exiting = true;
        Close();
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private void ConfigureWindow()
    {
        var settings = ConfigService.Current.Window;
        var width = Math.Max(1080, settings.Width);
        var height = Math.Max(680, settings.Height);
        AppWindow.Resize(new SizeInt32(width, height));
        if (settings.X is int x && settings.Y is int y)
        {
            try
            {
                AppWindow.Move(new PointInt32(x, y));
            }
            catch
            {
                /* 屏幕配置变化时忽略旧坐标 */
            }
        }
        if (settings.Maximized)
        {
            try
            {
                (AppWindow.Presenter as OverlappedPresenter)?.Maximize();
            }
            catch
            {
                /* ignore */
            }
        }

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarArea);
        var titleBar = AppWindow.TitleBar;
        titleBar.ButtonBackgroundColor = Colors.Transparent;
        titleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        UpdateTitleBarTheme();

        try
        {
            AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico"));
        }
        catch
        {
            /* 图标可选 */
        }
    }

    /// <summary>先展示主界面（有缓存就先展示缓存），连接过程完全放到后台。</summary>
    public void ApplyTheme(string? theme)
    {
        Root.RequestedTheme = (theme ?? "").Trim().ToLowerInvariant() switch
        {
            "light" => ElementTheme.Light,
            "dark" => ElementTheme.Dark,
            _ => ElementTheme.Default,
        };
        SyncActualTheme();
        DispatcherQueue.TryEnqueue(SyncActualTheme);
    }

    private void SyncActualTheme()
    {
        ThemeService.Set(Root.ActualTheme);
        UpdateTitleBarTheme();
        RefreshUserCard();
        UpdateHeartIcon();
        UpdateDesktopLyricsButtons();
    }

    private void UpdateTitleBarTheme()
    {
        var titleBar = AppWindow.TitleBar;
        var light = Root.ActualTheme == ElementTheme.Light;
        titleBar.ButtonForegroundColor = light ? ColorHelper.FromArgb(255, 24, 32, 51) : ColorHelper.FromArgb(255, 238, 242, 248);
        titleBar.ButtonInactiveForegroundColor = light ? ColorHelper.FromArgb(255, 120, 132, 150) : ColorHelper.FromArgb(255, 140, 150, 168);
        titleBar.ButtonHoverBackgroundColor = light ? ColorHelper.FromArgb(255, 232, 238, 247) : ColorHelper.FromArgb(255, 30, 36, 50);
        titleBar.ButtonHoverForegroundColor = light ? ColorHelper.FromArgb(255, 24, 32, 51) : Colors.White;
    }

    public void StartShell()
    {
        NavigateTo(typeof(HomePage), null, "home");
        // 有保存的登录 token 时，先在左下角显示“登录中…”，等后台恢复完成再替换成账号。
        _authPending = !string.IsNullOrEmpty(ConfigService.Current.Token);
        RefreshUserCard();
        _ = HideBootSplashAsync();
        _ = InitializeAsync();
    }

    private async Task HideBootSplashAsync()
    {
        await Task.Delay(180);
        BootSplash.Visibility = Visibility.Collapsed;
    }

    public async Task InitializeAsync()
    {
        if (_initializing || _exiting) return;
        _initializing = true;
        try
        {
            AppLog.Write("window init start api=" + ConfigService.Current.ApiBase);
            await LocalMediaServer.Instance.StartAsync();
            var (ok, message, version) = await ApiService.TestConnectionAsync(ConfigService.Current.ApiBase);
            if (!ok)
            {
                AppLog.Write("background connect failed: " + message);
                _authPending = false;
                RefreshUserCard();
                ScheduleRetry();
                return;
            }

            AppLog.Write("connected api=" + ConfigService.Current.ApiBase + " version=" + version);
            _authPending = !string.IsNullOrEmpty(ConfigService.Current.Token);
            RefreshUserCard();
            await AuthService.Instance.InitializeAsync();
            await LibraryService.Instance.ReloadAsync();
            RefreshUserCard();

            // 连接成功后再把当前页面刷新成最新数据；用户不会看到连接过程。
            await RefreshCurrentPageAsync();
        }
        catch (Exception ex)
        {
            AppLog.Write("background init failed: " + ex.Message);
            ScheduleRetry();
        }
        finally
        {
            _initializing = false;
            _authPending = false;
            RefreshUserCard();
        }
    }

    private async Task RefreshCurrentPageAsync()
    {
        if (ContentFrame.Content is HomePage home)
        {
            await home.RefreshAsync();
        }
    }

    private async void ScheduleRetry()
    {
        if (_retryScheduled || _exiting) return;
        _retryScheduled = true;
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(8));
        }
        finally
        {
            _retryScheduled = false;
        }
        if (!_exiting) await InitializeAsync();
    }

    public void NavigateTo(Type pageType, object? parameter = null, string? navKey = null)
    {
        ContentFrame.Navigate(pageType, parameter);
        if (!string.IsNullOrEmpty(navKey)) SetNavSelected(navKey);
    }

    private void ContentFrame_Navigated(object sender, Microsoft.UI.Xaml.Navigation.NavigationEventArgs e)
    {
        BackButton.IsEnabled = ContentFrame.CanGoBack;
    }

    private void SetNavSelected(string key)
    {
        var accent = ThemeService.Brush("AccentBrush");
        var accentSoft = ThemeService.Brush("AccentSoftBrush");
        var dim = ThemeService.Brush("TextDimBrush");
        foreach (var panel in new[] { MainNav, LibraryNav })
        {
            foreach (var child in panel.Children)
            {
                if (child is not Button button) continue;
                var active = (button.Tag as string) == key;
                button.Background = active ? accentSoft : new SolidColorBrush(Colors.Transparent);
                button.Foreground = active ? accent : dim;
            }
        }
    }

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        var tag = button.Tag as string ?? "home";
        switch (tag)
        {
            case "home":
                NavigateTo(typeof(HomePage), null, "home");
                break;
            case "charts":
                NavigateTo(typeof(ChartsPage), null, "charts");
                break;
            case "square":
                NavigateTo(typeof(SquarePage), null, "square");
                break;
            case "search":
                NavigateTo(typeof(SearchPage), null, "search");
                break;
            case "settings":
                NavigateTo(typeof(SettingsPage), null, "settings");
                break;
            case "liked":
                NavigateTo(typeof(LibraryPage), "liked", "liked");
                break;
            case "recent":
                NavigateTo(typeof(LibraryPage), "recent", "recent");
                break;
            case "downloads":
                NavigateTo(typeof(DownloadsPage), null, "downloads");
                break;
        }
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (NowPlayingOverlay.Visibility == Visibility.Visible)
        {
            NowPlayingOverlay.Visibility = Visibility.Collapsed;
            return;
        }
        if (QueueOverlay.Visibility == Visibility.Visible)
        {
            QueueOverlay.Visibility = Visibility.Collapsed;
            return;
        }
        if (ContentFrame.CanGoBack)
        {
            ContentFrame.GoBack();
        }
    }

    private void GlobalSearch_QuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        var query = (args.QueryText ?? sender.Text ?? "").Trim();
        NavigateTo(typeof(SearchPage), query, "search");
    }

    private void RefreshUserCard()
    {
        var user = AuthService.Instance.User;
        if (user is null)
        {
            if (_authPending && !string.IsNullOrEmpty(ConfigService.Current.Token))
            {
                UserInitial.Text = "…";
                UserName.Text = "登录中…";
                UserRole.Text = "";
            }
            else
            {
                UserInitial.Text = "♪";
                UserName.Text = "登录 / 注册";
                UserRole.Text = "同步歌单与收藏";
            }
        }
        else
        {
            UserInitial.Text = user.Initial;
            UserName.Text = user.Nickname;
            UserRole.Text = user.RoleText;
        }
    }

    private async void UserButton_Click(object sender, RoutedEventArgs e)
    {
        if (!AuthService.Instance.IsLoggedIn)
        {
            if (_authPending)
            {
                Notify.Show("正在登录，请稍候…");
                return;
            }
            await Dialogs.LoginAsync();
            RefreshUserCard();
            return;
        }
        var flyout = new MenuFlyout();
        var settings = new MenuFlyoutItem { Text = "账号与设置" };
        settings.Click += (_, _) => NavigateTo(typeof(SettingsPage), null, "settings");
        flyout.Items.Add(settings);
        if (AuthService.Instance.IsAdmin)
        {
            var admin = new MenuFlyoutItem { Text = "打开管理后台" };
            admin.Click += (_, _) => OpenExternal(ApiService.BaseUrl + "/#/admin");
            flyout.Items.Add(admin);
        }
        flyout.Items.Add(new MenuFlyoutSeparator());
        var logout = new MenuFlyoutItem { Text = "退出登录" };
        logout.Click += async (_, _) =>
        {
            await AuthService.Instance.LogoutAsync();
            RefreshUserCard();
            NavigateTo(typeof(HomePage), null, "home");
            Notify.Show("已退出登录");
        };
        flyout.Items.Add(logout);
        flyout.ShowAt(UserButton);
    }

    private static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            Notify.Show("无法打开浏览器", true);
        }
    }

    private async void AddPlaylist_Click(object sender, RoutedEventArgs e)
    {
        var name = await Dialogs.PromptAsync("新建歌单", "给歌单起个名字", "", "创建");
        if (name is null) return;
        var playlist = await LibraryService.Instance.CreatePlaylistAsync(name);
        if (playlist is not null)
        {
            Notify.Show("歌单已创建");
            NavigateTo(typeof(LibraryPage), playlist);
            SetNavSelected("");
        }
    }

    private void SidebarPlaylist_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is Playlist playlist)
        {
            NavigateTo(typeof(LibraryPage), playlist);
            SetNavSelected("");
        }
    }

    // ---------------- 播放控制 ----------------
    private async void PlayPause_Click(object sender, RoutedEventArgs e) => await Player.PlayPauseAsync();

    private void Prev_Click(object sender, RoutedEventArgs e) => Player.Previous();

    private void Next_Click(object sender, RoutedEventArgs e) => Player.Next();

    private void Shuffle_Click(object sender, RoutedEventArgs e) => Player.ToggleShuffle();

    private void Repeat_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        var flyout = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Top };
        var current = PlaybackOrder.Mode(Player.RepeatMode, Player.Shuffle);
        (string Mode, string Name, string Glyph)[] modes = [("shuffle", "随机播放", "\uE8B1"), ("off", "顺序播放", "\uE8FD"), ("one", "单曲循环", "\uE8ED"), ("all", "列表循环", "\uE8EE")];
        foreach (var mode in modes)
        {
            var item = new ToggleMenuFlyoutItem { Text = mode.Name, IsChecked = current == mode.Mode, Icon = new FontIcon { Glyph = mode.Glyph, FontSize = 16 } };
            item.Click += (_, _) => Player.SetPlaybackMode(mode.Mode);
            flyout.Items.Add(item);
        }
        flyout.ShowAt(button);
    }

    private void ToggleMute_Click(object sender, RoutedEventArgs e) => Player.ToggleMute();

    private void FullVolume_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement anchor) VolumeFlyout.ShowAt(anchor);
    }

    private void VolumeFlyout_Opened(object? sender, object e)
    {
        _volumeOpen = true;
        UpdateVolumeUI();
        UpdatePlayerInfoMode(pointerInside: true);
    }

    private void VolumeFlyout_Closed(object? sender, object e)
    {
        _volumeOpen = false;
        _draggingVolume = false;
        ConfigService.Save();
    }

    private void UpdateVolumeUI()
    {
        if (!_draggingVolume)
        {
            _updatingVolume = true;
            VolumeSlider.Value = Player.Volume;
            _updatingVolume = false;
        }
        VolumePercentText.Text = $"{Math.Round((Player.IsMuted ? 0 : Player.Volume) * 100)}%";
        var label = Player.IsMuted ? "取消静音" : "静音";
        ToolTipService.SetToolTip(VolumeMuteButton, label);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(VolumeMuteButton, label);
    }

    private void Root_PointerActivity(object sender, PointerRoutedEventArgs e) => UpdatePlayerInfoMode(pointerInside: true);
    private void Root_KeyActivity(object sender, KeyRoutedEventArgs e) => UpdatePlayerInfoMode(pointerInside: true);

    private void UpdatePlayerInfoMode(bool? pointerInside = null)
    {
        var inside = pointerInside ?? IsPointerOverWindow();
        var show = _playerInfoIdle.Update(inside || _volumeOpen,
            Player.IsPlaying && !string.IsNullOrWhiteSpace(Player.ActiveLyric) && string.IsNullOrEmpty(Player.ErrorMessage),
            Stopwatch.GetElapsedTime(_idleClock));
        var focus = _focusIdle.Update(inside || _volumeOpen || QueueOverlay.Visibility == Visibility.Visible,
            Player.IsPlaying && NowPlayingOverlay.Visibility == Visibility.Visible && string.IsNullOrEmpty(Player.ErrorMessage),
            Stopwatch.GetElapsedTime(_idleClock));
        SetFocusMode(focus);
        PlayerTitleInfo.Visibility = show ? Visibility.Collapsed : Visibility.Visible;
        PlayerLyricLine.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private bool IsPointerOverWindow()
    {
        if (!GetCursorPos(out var point)) return true;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        // Includes owned popups and the native title bar; covered or minimized
        // windows do not count merely because the pointer is inside their bounds.
        return GetAncestor(WindowFromPoint(point), 3) == hwnd;
    }

    [StructLayout(LayoutKind.Sequential)] private struct PointerPoint { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out PointerPoint point);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(PointerPoint point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    private void DesktopLyrics_Click(object sender, RoutedEventArgs e)
    {
        ConfigService.Current.DesktopLyrics = !ConfigService.Current.DesktopLyrics;
        ConfigService.Save();
        DesktopLyrics.Instance.Refresh();
        UpdateDesktopLyricsButtons();
    }

    private void DesktopLyrics_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        e.Handled = true;
        DesktopLyrics.Instance.ShowSettings();
    }

    private void UpdateDesktopLyricsButtons()
    {
        var enabled = ConfigService.Current.DesktopLyrics;
        foreach (var button in new[] { LyricsButton })
        {
            button.Foreground = ThemeService.Brush(enabled ? "AccentBrush" : "TextDimBrush");
            ToolTipService.SetToolTip(button, enabled ? "关闭桌面歌词" : "开启桌面歌词");
        }
    }

    private async void PlayerFavorite_Click(object sender, RoutedEventArgs e)
    {
        if (Player.Current is null) return;
        await LibraryService.Instance.ToggleFavoriteAsync(Player.Current);
        UpdateHeartIcon();
    }

    private void UpdateHeartIcon()
    {
        if (Player.Current is null)
        {
            PlayerHeartIcon.Glyph = "\uEB51";
            PlayerHeartIcon.Foreground = ThemeService.Brush("TextDimBrush");
            return;
        }
        var favorite = LibraryService.Instance.IsFavorite(Player.Current);
        PlayerHeartIcon.Glyph = favorite ? "\uEB52" : "\uEB51";
        PlayerHeartIcon.Foreground = (Brush)Application.Current.Resources[(favorite ? "PinkBrush" : "TextDimBrush")];
    }

    private void Quality_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        var flyout = new MenuFlyout();
        flyout.Items.Add(new MenuFlyoutItem { Text = "当前：" + PlaybackQuality.Name(Player.CurrentQuality), IsEnabled = false });
        var autoItem = new ToggleMenuFlyoutItem { Text = "自动", IsChecked = Player.RequestedQuality == "auto" };
        autoItem.Click += async (_, _) => await Player.SetQualityAsync("auto");
        flyout.Items.Add(autoItem);
        flyout.Items.Add(new MenuFlyoutSeparator());
        var qualities = Player.Current?.Qualities?.Distinct().ToList() ?? new List<string> { "flac", "320k", "128k" };
        foreach (var quality in qualities)
        {
            var item = new ToggleMenuFlyoutItem { Text = QualityName(quality), IsChecked = Player.RequestedQuality == quality };
            item.Click += async (_, _) => await Player.SetQualityAsync(quality);
            flyout.Items.Add(item);
        }
        flyout.ShowAt(button);
    }

    private static string QualityName(string quality) => quality switch
    {
        "flac24bit" => "Hi-Res 无损",
        "flac" => "无损 SQ",
        "320k" => "高品质 HQ",
        "128k" => "标准音质",
        _ => quality,
    };

    private void ProgressSlider_ValueChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        if (_updatingProgress) return;
        Player.Seek(TimeSpan.FromSeconds(e.NewValue));
    }

    private void FullProgressSlider_ValueChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        if (_updatingProgress) return;
        Player.Seek(TimeSpan.FromSeconds(e.NewValue));
    }

    private void VolumeSlider_ValueChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        if (_updatingVolume) return;
        Player.SetVolume(e.NewValue);
    }

    private void ProgressSlider_Tapped(object sender, TappedRoutedEventArgs e)
    {
        if (sender is Slider slider) SeekFromSliderPoint(slider, e.GetPosition(slider).X);
    }

    private void FullProgressSlider_Tapped(object sender, TappedRoutedEventArgs e)
    {
        if (sender is Slider slider) SeekFromSliderPoint(slider, e.GetPosition(slider).X);
    }

    private void SeekFromSliderPoint(Slider slider, double x)
    {
        if (slider.ActualWidth <= 0) return;
        var ratio = Math.Clamp(x / slider.ActualWidth, 0, 1);
        var seconds = ratio * slider.Maximum;
        _updatingProgress = true;
        slider.Value = seconds;
        _updatingProgress = false;
        Player.Seek(TimeSpan.FromSeconds(seconds));
    }

    private void Player_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(MediaService.PositionSeconds):
                if (!_draggingProgress) UpdateProgressSliders(Player.PositionSeconds);
                break;
            case nameof(MediaService.DurationSeconds):
                UpdateProgressMaximum(Player.DurationSeconds);
                break;
            case nameof(MediaService.Volume):
            case nameof(MediaService.IsMuted):
                UpdateVolumeUI();
                break;
            case nameof(MediaService.ActiveLyricIndex):
                UpdateLyricSelection();
                break;
            case nameof(MediaService.Current):
            case nameof(MediaService.HasCurrent):
                UpdateHeartIcon();
                UpdatePlayerInfoMode();
                TrayIcon.Instance.UpdateTooltip(Player.Current is null
                    ? "觅音"
                    : "觅音 · " + Player.Title + " - " + Player.Singer);
                break;
            case nameof(MediaService.QueueIndex):
                UpdateQueueState();
                break;
            case nameof(MediaService.IsPlaying):
            case nameof(MediaService.ErrorMessage):
                UpdatePlayerInfoMode();
                break;
        }
    }

    private void UpdateProgressSliders(double seconds)
    {
        _updatingProgress = true;
        ProgressSlider.Value = seconds;
        _updatingProgress = false;
    }

    private void UpdateProgressMaximum(double seconds)
    {
        _updatingProgress = true;
        ProgressSlider.Maximum = Math.Max(1, seconds);
        _updatingProgress = false;
    }

    private void UpdateLyricsEmptyState()
    {
        NoLyricsText.Visibility = Player.Lyrics.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (Player.Lyrics.Count == 0) PlayerLyricLine.Text = "";
        UpdatePlayerInfoMode();
    }

    private void UpdateLyricSelection()
    {
        var index = Player.ActiveLyricIndex;
        for (var i = 0; i < Player.Lyrics.Count; i++)
        {
            Player.Lyrics[i].IsActive = i == index;
        }
        PlayerLyricLine.Text = index >= 0 && index < Player.Lyrics.Count
            ? Player.Lyrics[index].Text
            : "";
        UpdatePlayerInfoMode();
        if (index < 0 || index >= Player.Lyrics.Count || NowPlayingOverlay.Visibility != Visibility.Visible)
        {
            return;
        }

        DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                LyricsList.ScrollIntoView(Player.Lyrics[index], ScrollIntoViewAlignment.Default);
                DispatcherQueue.TryEnqueue(() => CenterActiveLyric(index));
            }
            catch
            {
                /* ignore */
            }
        });
    }

    private void CenterActiveLyric(int index)
    {
        try
        {
            if (LyricsList.ContainerFromIndex(index) is not ListViewItem item) return;
            var viewer = FindDescendant<ScrollViewer>(LyricsList);
            if (viewer is null) return;
            var point = item.TransformToVisual(LyricsList).TransformPoint(new Point(0, 0));
            var target = viewer.VerticalOffset + point.Y - (viewer.ViewportHeight - item.ActualHeight) / 2;
            viewer.ChangeView(null, Math.Max(0, target), null, false);
        }
        catch
        {
            /* 歌词滚动失败不影响播放 */
        }
    }

    private static T? FindDescendant<T>(DependencyObject root) where T : DependencyObject
    {
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < count; i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T match) return match;
            var found = FindDescendant<T>(child);
            if (found is not null) return found;
        }
        return null;
    }

    private void SetFocusMode(bool focus)
    {
        if (_focusMode == focus) return;
        _focusMode = focus;
        foreach (var element in new UIElement[] { PlayerBarSurface, NowPlayingHeader, TitleBarArea })
        {
            element.IsHitTestVisible = !focus;
            var animation = new DoubleAnimation { To = focus ? 0 : 1, Duration = new Duration(TimeSpan.FromMilliseconds(focus ? 250 : 100)) };
            Storyboard.SetTarget(animation, element);
            Storyboard.SetTargetProperty(animation, "Opacity");
            var story = new Storyboard(); story.Children.Add(animation); story.Begin();
        }
    }

    private void NowPlayingBody_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var size = Math.Clamp(Math.Min(e.NewSize.Height - 48, (e.NewSize.Width - 168) / 2), 160, 420);
        FullCover.Width = FullCover.Height = size;
    }

    private void PlayerBar_Tapped(object sender, TappedRoutedEventArgs e)
    {
        for (var node = e.OriginalSource as DependencyObject; node is not null && node != PlayerBarSurface; node = VisualTreeHelper.GetParent(node))
            if (node is Microsoft.UI.Xaml.Controls.Primitives.ButtonBase or Microsoft.UI.Xaml.Controls.Primitives.RangeBase or Microsoft.UI.Xaml.Controls.Primitives.ScrollBar) return;
        e.Handled = true;
        OpenNowPlaying();
    }

    private void SidebarToggle_Click(object sender, RoutedEventArgs e)
    {
        ConfigService.Current.SidebarCollapsed = !ConfigService.Current.SidebarCollapsed;
        ApplySidebar();
        ConfigService.Save();
    }

    private void ApplySidebar()
    {
        var collapsed = ConfigService.Current.SidebarCollapsed;
        SidebarColumn.Width = new GridLength(collapsed ? 72 : 216);
        foreach (var button in MainNav.Children.Concat(LibraryNav.Children).OfType<Button>())
        {
            if (button.Content is not StackPanel panel) continue;
            foreach (var label in panel.Children.OfType<TextBlock>())
            {
                label.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
                ToolTipService.SetToolTip(button, label.Text);
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, label.Text);
            }
            button.Padding = collapsed ? new Thickness(16, 0, 16, 0) : new Thickness(12, 0, 12, 0);
        }
        LibrarySectionLabel.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        PlaylistSectionHeader.Children[0].Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        PlaylistSectionHeader.Margin = collapsed ? new Thickness(0, 12, 12, 4) : new Thickness(12, 14, 4, 5);
        if (UserButton.Content is Grid user)
        {
            user.ColumnDefinitions[0].Width = new GridLength(collapsed ? 32 : 36);
            UserButton.Padding = collapsed ? new Thickness(10, 0, 10, 0) : new Thickness(12, 0, 12, 0);
            foreach (var child in user.Children.OfType<FrameworkElement>()) if (Grid.GetColumn(child) > 0) child.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        }
        SidebarToggleIcon.Glyph = collapsed ? "\uE76C" : "\uE76B";
        var name = collapsed ? "展开导航栏" : "收起导航栏";
        ToolTipService.SetToolTip(SidebarToggle, name);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(SidebarToggle, name);
        foreach (var item in LibraryService.Instance.Playlists)
            if (SidebarPlaylists.ContainerFromItem(item) is ListViewItem container && container.ContentTemplateRoot is Grid grid) ApplyPlaylistRail(grid);
    }

    private void SidebarPlaylist_Loaded(object sender, RoutedEventArgs e) { if (sender is Grid grid) ApplyPlaylistRail(grid); }
    private static void ApplyPlaylistRail(Grid grid)
    {
        foreach (var label in grid.Children.OfType<TextBlock>()) label.Visibility = ConfigService.Current.SidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;
    }

    private void OpenNowPlaying()
    {
        if (!Player.HasCurrent || NowPlayingOverlay.Visibility == Visibility.Visible) return;
        QueueOverlay.Visibility = Visibility.Collapsed;
        NowPlayingOverlay.Visibility = Visibility.Visible;
        UpdatePlayerInfoMode(pointerInside: true);
        NowPlayingOverlay.Opacity = 0;

        var fade = new DoubleAnimation
        {
            To = 1,
            Duration = new Duration(TimeSpan.FromMilliseconds(220)),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(fade, NowPlayingOverlay);
        Storyboard.SetTargetProperty(fade, "Opacity");
        var story = new Storyboard();
        story.Children.Add(fade);
        var slide = new DoubleAnimation { From = 32, To = 0, Duration = fade.Duration, EasingFunction = fade.EasingFunction };
        Storyboard.SetTarget(slide, NowPlayingTranslate);
        Storyboard.SetTargetProperty(slide, "Y");
        story.Children.Add(slide);
        story.Begin();

        UpdateLyricSelection();
    }

    private void PlayerInfo_Tapped(object sender, TappedRoutedEventArgs e) { e.Handled = true; OpenNowPlaying(); }

    private void FullPlayer_Click(object sender, RoutedEventArgs e) => OpenNowPlaying();

    private void CloseNowPlaying_Click(object sender, RoutedEventArgs e) { NowPlayingOverlay.Visibility = Visibility.Collapsed; SetFocusMode(false); }

    private void FullQueue_Click(object sender, RoutedEventArgs e)
    {
        QueueOverlay.Visibility = Visibility.Visible;
        UpdateQueueState();
        if (Player.Current is not null)
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    QueueList.ScrollIntoView(Player.Current);
                }
                catch
                {
                    /* ignore */
                }
            });
        }
    }

    private void Lyric_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is LyricLine line) Player.Seek(line.Time - TimeSpan.FromSeconds(ConfigService.Current.LyricOffset));
    }

    private void Queue_Click(object sender, RoutedEventArgs e)
    {
        if (QueueOverlay.Visibility == Visibility.Visible)
        {
            QueueOverlay.Visibility = Visibility.Collapsed;
            return;
        }
        QueueOverlay.Visibility = Visibility.Visible;
        NowPlayingOverlay.Visibility = Visibility.Collapsed;
        UpdateQueueState();
        if (Player.Current is not null)
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    QueueList.ScrollIntoView(Player.Current);
                }
                catch
                {
                    /* ignore */
                }
            });
        }
    }

    private void CloseQueue_Click(object sender, RoutedEventArgs e) => QueueOverlay.Visibility = Visibility.Collapsed;

    private void Queue_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not Song song) return;
        var index = Player.Queue.IndexOf(song);
        if (index >= 0) Player.PlayAt(index);
    }

    private void QueueRemove_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not Song song) return;
        var index = Player.Queue.IndexOf(song);
        if (index >= 0) Player.RemoveFromQueue(index);
        UpdateQueueState();
    }

    private void QueueClear_Click(object sender, RoutedEventArgs e)
    {
        Player.ClearQueue();
        UpdateQueueState();
    }

    private void UpdateQueueState()
    {
        QueueCountText.Text = Player.Queue.Count > 0 ? Player.Queue.Count + " 首" : "";
        QueueEmptyText.Visibility = Player.Queue.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ShowToast(object? sender, NotifyEventArgs e)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            ToastBar.Title = e.IsError ? "操作失败" : "提示";
            ToastBar.Message = e.Message;
            ToastBar.Severity = e.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
            ToastBar.IsOpen = true;
            _toastTimer.Stop();
            _toastTimer.Start();
        });
    }

    private void MainWindow_Closed(object sender, WindowEventArgs args)
    {
        _playerInfoTimer.Stop();
        ConfigService.Save();
        var presenter = AppWindow.Presenter as OverlappedPresenter;
        var maximized = presenter?.State == OverlappedPresenterState.Maximized;
        ConfigService.SaveWindow(AppWindow.Size.Width, AppWindow.Size.Height, AppWindow.Position.X, AppWindow.Position.Y, maximized);
        DesktopLyrics.Instance.Dispose();
        Player.Dispose();
        TrayIcon.Instance.Dispose();
        WindowIcon.Dispose();
        _ = LocalMediaServer.Instance.StopAsync();
    }
}

