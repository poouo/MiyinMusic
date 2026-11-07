using System.Runtime.InteropServices;

namespace MiYin.Desktop.Services;

/// <summary>Win32 托盘图标：左键恢复主窗口，右键菜单播放 / 上一首 / 下一首 / 退出。</summary>
public sealed class TrayIcon
{
    public static TrayIcon Instance { get; } = new();

    private const uint WmTray = 0x8001;
    private const uint WmCommand = 0x0111;
    private const uint WmNull = 0x0000;
    private const uint WmLButtonUp = 0x0202;
    private const uint WmLButtonDblClk = 0x0203;
    private const uint WmRButtonUp = 0x0205;
    private const uint WmContextMenu = 0x007B;
    private const uint NinSelect = 0x0400;

    private const uint NimAdd = 0;
    private const uint NimModify = 1;
    private const uint NimDelete = 2;
    private const uint NifMessage = 0x00000001;
    private const uint NifIcon = 0x00000002;
    private const uint NifTip = 0x00000004;
    private const uint NifInfo = 0x00000010;
    private const uint NifShowTip = 0x00000080;
    private const uint NiifInfo = 0x00000001;

    private const int IdOpen = 1001;
    private const int IdPlay = 1002;
    private const int IdPrevious = 1003;
    private const int IdNext = 1004;
    private const int IdExit = 1005;

    private const uint MfString = 0x00000000;
    private const uint MfSeparator = 0x00000800;
    private const uint TpmRightButton = 0x0002;
    private const uint TpmBottomAlign = 0x0020;
    private const uint TpmReturnCmd = 0x0100;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uTimeoutOrVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, IntPtr dwRefData);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Shell_NotifyIcon(uint dwMessage, ref NotifyIconData lpData);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadImage(IntPtr hinst, string name, uint type, int cx, int cy, uint load);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ExtractIconEx(string lpszFile, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, uint nIcons);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("comctl32.dll", SetLastError = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass, IntPtr dwRefData);

    [DllImport("comctl32.dll")]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    [DllImport("comctl32.dll")]
    private static extern bool RemoveWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenu(IntPtr hMenu, uint uFlags, UIntPtr uIDNewItem, string lpNewItem);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenu(IntPtr hMenu, uint uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private readonly SubclassProc _subclassProc;
    private IntPtr _hwnd;
    private IntPtr _icon;
    private bool _added;
    private bool _disposed;
    private bool _hintShown;

    private TrayIcon()
    {
        _subclassProc = WndProc;
    }

    public bool IsAvailable => _added;

    public void Initialize(IntPtr hwnd)
    {
        if (_added || hwnd == IntPtr.Zero) return;
        _hwnd = hwnd;
        _icon = WindowIcon.SmallIcon;
        if (_icon == IntPtr.Zero)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico");
            if (File.Exists(path)) _icon = LoadImage(IntPtr.Zero, path, 1, 16, 16, 0x10);
        }
        if (_icon == IntPtr.Zero)
        {
            try
            {
                var large = new IntPtr[1];
                var small = new IntPtr[1];
                if (ExtractIconEx(Environment.ProcessPath ?? "", 0, large, small, 1) > 0) _icon = small[0];
            }
            catch
            {
                /* ignore */
            }
        }

        if (!SetWindowSubclass(hwnd, _subclassProc, (UIntPtr)1, IntPtr.Zero))
        {
            AppLog.Write("tray SetWindowSubclass failed " + Marshal.GetLastWin32Error());
        }

        var data = CreateData();
        data.uFlags = NifMessage | NifIcon | NifTip | NifShowTip;
        data.szTip = "觅音";
        _added = Shell_NotifyIcon(NimAdd, ref data);
        AppLog.Write("tray add=" + _added + " icon=" + _icon);
    }

    public void UpdateTooltip(string text)
    {
        if (!_added || _disposed) return;
        var data = CreateData();
        data.uFlags = NifTip | NifShowTip;
        data.szTip = Truncate(string.IsNullOrWhiteSpace(text) ? "觅音" : text, 127);
        Shell_NotifyIcon(NimModify, ref data);
    }

    public void ShowBalloon(string title, string message)
    {
        if (!_added || _disposed || _hintShown) return;
        _hintShown = true;
        var data = CreateData();
        data.uFlags = NifInfo;
        data.szInfoTitle = Truncate(title, 63);
        data.szInfo = Truncate(message, 255);
        data.dwInfoFlags = NiifInfo;
        Shell_NotifyIcon(NimModify, ref data);
    }

    private NotifyIconData CreateData() => new()
    {
        cbSize = Marshal.SizeOf<NotifyIconData>(),
        hWnd = _hwnd,
        uID = 1,
        uCallbackMessage = WmTray,
        hIcon = _icon,
        szTip = "",
        szInfo = "",
        szInfoTitle = "",
    };

    private IntPtr WndProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, IntPtr dwRefData)
    {
        if (uMsg == WmTray)
        {
            var mouse = (uint)(lParam.ToInt64() & 0xFFFF);
            if (mouse is WmLButtonUp or WmLButtonDblClk or NinSelect)
            {
                MainWindow.Instance?.ShowFromTray();
                return IntPtr.Zero;
            }
            if (mouse is WmRButtonUp or WmContextMenu)
            {
                ShowMenu();
                return IntPtr.Zero;
            }
        }
        else if (uMsg == WmCommand)
        {
            var id = (int)(wParam.ToInt64() & 0xFFFF);
            if (id is >= IdOpen and <= IdExit)
            {
                HandleCommand(id);
                return IntPtr.Zero;
            }
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    private void ShowMenu()
    {
        if (_hwnd == IntPtr.Zero) return;
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return;
        try
        {
            AppendMenu(menu, MfString, (UIntPtr)IdOpen, "打开觅音");
            AppendMenu(menu, MfString, (UIntPtr)IdPlay, MediaService.Instance.IsPlaying ? "暂停" : "播放");
            AppendMenu(menu, MfString, (UIntPtr)IdPrevious, "上一首");
            AppendMenu(menu, MfString, (UIntPtr)IdNext, "下一首");
            AppendMenu(menu, MfSeparator, UIntPtr.Zero, "");
            AppendMenu(menu, MfString, (UIntPtr)IdExit, "退出");

            SetForegroundWindow(_hwnd);
            GetCursorPos(out var point);
            var command = TrackPopupMenu(menu, TpmRightButton | TpmBottomAlign | TpmReturnCmd, point.X, point.Y, 0, _hwnd, IntPtr.Zero);
            PostMessage(_hwnd, WmNull, IntPtr.Zero, IntPtr.Zero);
            if (command > 0) HandleCommand(command);
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private static void HandleCommand(int id)
    {
        switch (id)
        {
            case IdOpen:
                MainWindow.Instance?.ShowFromTray();
                break;
            case IdPlay:
                _ = MediaService.Instance.PlayPauseAsync();
                break;
            case IdPrevious:
                MediaService.Instance.Previous();
                break;
            case IdNext:
                MediaService.Instance.Next();
                break;
            case IdExit:
                MainWindow.Instance?.RequestExit();
                break;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_hwnd != IntPtr.Zero)
        {
            var data = CreateData();
            if (_added) Shell_NotifyIcon(NimDelete, ref data);
            RemoveWindowSubclass(_hwnd, _subclassProc, (UIntPtr)1);
        }
        if (_icon != IntPtr.Zero && _icon != WindowIcon.SmallIcon)
        {
            DestroyIcon(_icon);
        }
        _icon = IntPtr.Zero;
        _added = false;
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];
}
