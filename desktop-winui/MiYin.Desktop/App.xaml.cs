using Microsoft.UI.Xaml;
using MiYin.Desktop.Services;
using MiYin.Desktop.Views;

namespace MiYin.Desktop;

public partial class App : Application
{
    public static new App Current => (App)Application.Current;
    public MainWindow? MainWindow { get; private set; }

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, eventArgs) =>
        {
            try
            {
                Notify.Show("出现异常：" + eventArgs.Exception.Message, true);
            }
            catch
            {
                /* ignore */
            }
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        ConfigService.Initialize();
        LibraryService.Instance.Initialize();
        DownloadService.Instance.Initialize();
        CacheService.Instance.Initialize();

        MainWindow = new MainWindow();
        MainWindow.Activate();
        // 立即展示主界面；连接、账号同步都在后台静默进行。
        MainWindow.StartShell();
    }
}
