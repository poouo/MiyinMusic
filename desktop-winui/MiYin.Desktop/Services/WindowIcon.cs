using System.Runtime.InteropServices;

namespace MiYin.Desktop.Services;

/// <summary>
/// WinUI 3 的窗口图标只设置了 WM_GETICON；Windows 11 任务栏还会读取窗口类图标。
/// 这里把 ICO 同时写到窗口类和 WM_SETICON，任务栏才能显示自定义图标。
/// </summary>
public static class WindowIcon
{
    private const uint ImageIcon = 1;
    private const uint LrLoadFromFile = 0x10;
    private const int GclpHicon = -14;
    private const int GclpHiconSm = -34;
    private const uint WmSetIcon = 0x0080;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadImage(IntPtr hinst, string name, uint type, int cx, int cy, uint load);

    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW", SetLastError = true)]
    private static extern IntPtr SetClassLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ExtractIconEx(string lpszFile, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, uint nIcons);

    public static IntPtr LargeIcon { get; private set; }
    public static IntPtr SmallIcon { get; private set; }

    public static void Apply(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        if (LargeIcon == IntPtr.Zero)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico");
            if (File.Exists(path))
            {
                LargeIcon = LoadImage(IntPtr.Zero, path, ImageIcon, 32, 32, LrLoadFromFile);
                SmallIcon = LoadImage(IntPtr.Zero, path, ImageIcon, 16, 16, LrLoadFromFile);
            }
        }
        if (LargeIcon == IntPtr.Zero || SmallIcon == IntPtr.Zero)
        {
            try
            {
                var exe = Environment.ProcessPath ?? "";
                var large = new IntPtr[1];
                var small = new IntPtr[1];
                if (ExtractIconEx(exe, 0, large, small, 1) > 0)
                {
                    if (LargeIcon == IntPtr.Zero) LargeIcon = large[0];
                    if (SmallIcon == IntPtr.Zero) SmallIcon = small[0];
                }
            }
            catch
            {
                /* ignore */
            }
        }
        if (LargeIcon != IntPtr.Zero)
        {
            SetClassLongPtr(hwnd, GclpHicon, LargeIcon);
            SendMessage(hwnd, WmSetIcon, (IntPtr)1, LargeIcon);
        }
        if (SmallIcon != IntPtr.Zero)
        {
            SetClassLongPtr(hwnd, GclpHiconSm, SmallIcon);
            SendMessage(hwnd, WmSetIcon, (IntPtr)0, SmallIcon);
            SendMessage(hwnd, WmSetIcon, (IntPtr)2, SmallIcon);
        }
    }

    public static void Dispose()
    {
        if (LargeIcon != IntPtr.Zero)
        {
            DestroyIcon(LargeIcon);
            LargeIcon = IntPtr.Zero;
        }
        if (SmallIcon != IntPtr.Zero)
        {
            DestroyIcon(SmallIcon);
            SmallIcon = IntPtr.Zero;
        }
    }
}
