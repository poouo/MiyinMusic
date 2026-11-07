using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace MiYin.Desktop;

public static class Dialogs
{
    private static XamlRoot? Root => MainWindow.Instance?.Content.XamlRoot;

    public static async Task AddToPlaylistAsync(Song song)
    {
        if (Root is null) return;
        var panel = new StackPanel { Spacing = 10, Width = 360 };
        var hint = new TextBlock
        {
            Text = "选择要加入的歌单：" + song.Name,
            FontSize = 12,
            Foreground = (Brush)Application.Current.Resources["TextDimBrush"],
            TextWrapping = TextWrapping.Wrap,
        };
        panel.Children.Add(hint);

        var dialog = new ContentDialog
        {
            Title = "添加到歌单",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
            Content = panel,
            XamlRoot = Root,
        };

        var playlists = LibraryService.Instance.Playlists.ToList();
        if (playlists.Count == 0)
        {
            panel.Children.Add(new TextBlock
            {
                Text = "还没有歌单，先在下面创建一个吧。",
                FontSize = 12,
                Foreground = (Brush)Application.Current.Resources["TextFaintBrush"],
            });
        }
        else
        {
            var scroll = new ScrollViewer { MaxHeight = 280, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            var stack = new StackPanel { Spacing = 5 };
            foreach (var playlist in playlists)
            {
                var row = new Grid();
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.Children.Add(new TextBlock
                {
                    Text = playlist.Name,
                    FontSize = 13,
                    Foreground = (Brush)Application.Current.Resources["TextBrush"],
                    VerticalAlignment = VerticalAlignment.Center,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                var count = new TextBlock
                {
                    Text = playlist.CountText,
                    FontSize = 11,
                    Foreground = (Brush)Application.Current.Resources["TextFaintBrush"],
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(count, 1);
                row.Children.Add(count);

                var button = new Button
                {
                    Content = row,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Stretch,
                    Height = 40,
                    Padding = new Thickness(12, 0, 12, 0),
                    Style = Application.Current.Resources["GhostButtonStyle"] as Style,
                };
                button.Click += async (_, _) =>
                {
                    var added = await LibraryService.Instance.AddToPlaylistAsync(playlist, song);
                    if (added) dialog.Hide();
                };
                stack.Children.Add(button);
            }
            scroll.Content = stack;
            panel.Children.Add(scroll);
        }

        var createRow = new Grid { Margin = new Thickness(0, 6, 0, 0) };
        createRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        createRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var nameBox = new TextBox { PlaceholderText = "新建歌单名称", Height = 34, FontSize = 12 };
        createRow.Children.Add(nameBox);
        var createButton = new Button
        {
            Content = "创建并添加",
            Margin = new Thickness(8, 0, 0, 0),
            Style = Application.Current.Resources["PrimaryButtonStyle"] as Style,
            Height = 34,
            Padding = new Thickness(12, 0, 12, 0),
        };
        Grid.SetColumn(createButton, 1);
        createRow.Children.Add(createButton);
        panel.Children.Add(createRow);

        createButton.Click += async (_, _) =>
        {
            var name = nameBox.Text.Trim();
            if (name.Length == 0) return;
            var playlist = await LibraryService.Instance.CreatePlaylistAsync(name);
            if (playlist is null) return;
            await LibraryService.Instance.AddToPlaylistAsync(playlist, song);
            dialog.Hide();
        };

        await dialog.ShowAsync();
    }

    public static async Task LoginAsync()
    {
        var switchToRegister = await ShowLoginDialogAsync();
        if (switchToRegister) await RegisterAsync();
    }

    private static async Task<bool> ShowLoginDialogAsync()
    {
        if (Root is null) return false;

        // 登录和注册使用两个独立的 ContentDialog，不再用一个 ToggleSwitch 混在一起。
        var username = new TextBox { Header = "用户名", PlaceholderText = "请输入用户名" };
        var password = new PasswordBox { Header = "密码", PlaceholderText = "请输入密码" };
        var error = new TextBlock
        {
            Foreground = (Brush)Application.Current.Resources["PinkBrush"],
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Visibility = Visibility.Collapsed,
        };
        var switchLink = new HyperlinkButton
        {
            Content = "没有账号？立即注册",
            HorizontalAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(0),
            Margin = new Thickness(0, -2, 0, 0),
        };
        var allowRegister = AuthService.Instance.ServerConfig?.AllowRegister ?? true;
        switchLink.Visibility = allowRegister ? Visibility.Visible : Visibility.Collapsed;

        var panel = new StackPanel { Spacing = 12, Width = 340 };
        panel.Children.Add(new TextBlock
        {
            Text = "登录后可同步收藏、歌单和播放记录。",
            FontSize = 12,
            Foreground = (Brush)Application.Current.Resources["TextDimBrush"],
            TextWrapping = TextWrapping.Wrap,
        });
        panel.Children.Add(username);
        panel.Children.Add(password);
        panel.Children.Add(error);
        panel.Children.Add(switchLink);

        var dialog = new ContentDialog
        {
            Title = "登录觅音",
            PrimaryButtonText = "登录",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            Content = panel,
            XamlRoot = Root,
        };

        var busy = false;
        var switchToRegister = false;
        switchLink.Click += (_, _) =>
        {
            switchToRegister = true;
            dialog.Hide();
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            args.Cancel = true;
            if (busy) return;
            busy = true;
            error.Visibility = Visibility.Collapsed;
            try
            {
                var name = username.Text.Trim();
                if (name.Length == 0 || password.Password.Length == 0)
                {
                    error.Text = "请输入用户名和密码";
                    error.Visibility = Visibility.Visible;
                    return;
                }
                await AuthService.Instance.LoginAsync(name, password.Password);
                dialog.Hide();
                Notify.Show("登录成功，欢迎回来");
            }
            catch (Exception ex)
            {
                error.Text = ex.Message;
                error.Visibility = Visibility.Visible;
            }
            finally
            {
                busy = false;
            }
        };

        await dialog.ShowAsync();
        return switchToRegister;
    }

    public static async Task RegisterAsync()
    {
        if (Root is null) return;
        if (AuthService.Instance.ServerConfig is { AllowRegister: false })
        {
            Notify.Show("当前服务器未开放注册", true);
            return;
        }

        var username = new TextBox { Header = "用户名", PlaceholderText = "3-24 位字母、数字或下划线" };
        var nickname = new TextBox { Header = "昵称（可选）", PlaceholderText = "展示用的名字" };
        var password = new PasswordBox { Header = "密码", PlaceholderText = "至少 6 位" };
        var confirm = new PasswordBox { Header = "确认密码", PlaceholderText = "再次输入密码" };
        var error = new TextBlock
        {
            Foreground = (Brush)Application.Current.Resources["PinkBrush"],
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Visibility = Visibility.Collapsed,
        };
        var switchLink = new HyperlinkButton
        {
            Content = "已有账号？去登录",
            HorizontalAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(0),
            Margin = new Thickness(0, -2, 0, 0),
        };

        var panel = new StackPanel { Spacing = 12, Width = 340 };
        panel.Children.Add(new TextBlock
        {
            Text = "注册后收藏、歌单和播放记录会同步到账号。",
            FontSize = 12,
            Foreground = (Brush)Application.Current.Resources["TextDimBrush"],
            TextWrapping = TextWrapping.Wrap,
        });
        panel.Children.Add(username);
        panel.Children.Add(nickname);
        panel.Children.Add(password);
        panel.Children.Add(confirm);
        panel.Children.Add(error);
        panel.Children.Add(switchLink);

        var dialog = new ContentDialog
        {
            Title = "注册觅音账号",
            PrimaryButtonText = "注册并登录",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            Content = panel,
            XamlRoot = Root,
        };

        var busy = false;
        var switchToLogin = false;
        switchLink.Click += (_, _) =>
        {
            switchToLogin = true;
            dialog.Hide();
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            args.Cancel = true;
            if (busy) return;
            busy = true;
            error.Visibility = Visibility.Collapsed;
            try
            {
                var name = username.Text.Trim();
                if (name.Length == 0 || password.Password.Length < 6)
                {
                    error.Text = "用户名不能为空，密码至少 6 位";
                    error.Visibility = Visibility.Visible;
                    return;
                }
                if (password.Password != confirm.Password)
                {
                    error.Text = "两次输入的密码不一致";
                    error.Visibility = Visibility.Visible;
                    return;
                }
                await AuthService.Instance.RegisterAsync(name, password.Password, nickname.Text.Trim());
                dialog.Hide();
                Notify.Show("注册成功，欢迎使用觅音");
            }
            catch (Exception ex)
            {
                error.Text = ex.Message;
                error.Visibility = Visibility.Visible;
            }
            finally
            {
                busy = false;
            }
        };

        await dialog.ShowAsync();
        if (switchToLogin) await LoginAsync();
    }

    public static async Task<string?> PromptAsync(string title, string placeholder, string initial, string primary = "确定")
    {
        if (Root is null) return null;
        var box = new TextBox { Text = initial, PlaceholderText = placeholder, Height = 38, FontSize = 13 };
        var panel = new StackPanel { Spacing = 8, Width = 340 };
        panel.Children.Add(box);
        var dialog = new ContentDialog
        {
            Title = title,
            Content = panel,
            PrimaryButtonText = primary,
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = Root,
        };
        box.Loaded += (_, _) => box.Focus(FocusState.Programmatic);
        var result = await dialog.ShowAsync();
        var text = box.Text.Trim();
        return result == ContentDialogResult.Primary && text.Length > 0 ? text : null;
    }

    public static async Task<bool> ConfirmAsync(string title, string message, string primary = "确定")
    {
        if (Root is null) return false;
        var dialog = new ContentDialog
        {
            Title = title,
            Content = new TextBlock
            {
                Text = message,
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)Application.Current.Resources["TextDimBrush"],
            },
            PrimaryButtonText = primary,
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = Root,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }
}
