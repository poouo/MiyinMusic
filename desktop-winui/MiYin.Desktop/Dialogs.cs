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
        if (Root is null) return;
        // 带 Header 的输入框不要再固定 38px 高度：Header 会占掉空间，输入区域会被压成一条线。
        var username = new TextBox { Header = "用户名", PlaceholderText = "请输入用户名" };
        var password = new PasswordBox { Header = "密码", PlaceholderText = "请输入密码" };
        var nickname = new TextBox { Header = "昵称（可选）", Visibility = Visibility.Collapsed };
        var registerSwitch = new ToggleSwitch { Header = "注册新账号", IsOn = false };
        var allowRegister = AuthService.Instance.ServerConfig?.AllowRegister ?? true;
        registerSwitch.Visibility = allowRegister ? Visibility.Visible : Visibility.Collapsed;
        var error = new TextBlock
        {
            Foreground = (Brush)Application.Current.Resources["PinkBrush"],
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Visibility = Visibility.Collapsed,
        };
        var panel = new StackPanel { Spacing = 10, Width = 340 };
        panel.Children.Add(username);
        panel.Children.Add(password);
        panel.Children.Add(nickname);
        panel.Children.Add(registerSwitch);
        panel.Children.Add(error);

        var dialog = new ContentDialog
        {
            Title = "登录",
            PrimaryButtonText = "登录",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            Content = panel,
            XamlRoot = Root,
        };
        var busy = false;
        registerSwitch.Toggled += (_, _) =>
        {
            var register = registerSwitch.IsOn;
            nickname.Visibility = register ? Visibility.Visible : Visibility.Collapsed;
            dialog.Title = register ? "注册觅音账号" : "登录";
            dialog.PrimaryButtonText = register ? "注册" : "登录";
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
                if (registerSwitch.IsOn)
                {
                    await AuthService.Instance.RegisterAsync(name, password.Password, nickname.Text.Trim());
                }
                else
                {
                    await AuthService.Instance.LoginAsync(name, password.Password);
                }
                dialog.Hide();
                Notify.Show(registerSwitch.IsOn ? "注册成功，欢迎使用觅音" : "登录成功");
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
