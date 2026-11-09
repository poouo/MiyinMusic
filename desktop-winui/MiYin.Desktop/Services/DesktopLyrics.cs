using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;

namespace MiYin.Desktop.Services;

/// <summary>Independent per-pixel-alpha, topmost lyric window. Uses the existing UI message pump.</summary>
public sealed class DesktopLyrics : IDisposable
{
    public static DesktopLyrics Instance { get; } = new();
    private readonly WindowProc _proc;
    private IntPtr _window;
    private DispatcherQueueTimer? _timer;
    private string _last = "";
    private string _settingsKey = "";
    private bool _hovered, _menuOpen;
    private int _hoverButton = -1;
    private int _pressedButton = -1;
    private bool _resizing, _resizeCorner;
    private Rect _resizeBounds;
    private PointNative _resizePointer;
    private int _resizeFontSize;
    public event EventHandler? Changed;
    private const int ToolbarCount = DesktopLyricsControls.Count;
    private const string ClassName = "MiYinDesktopLyrics";
    private DesktopLyrics() { _proc = WndProc; }

    public void Initialize()
    {
        if (_timer is not null) return;
        _timer = DispatcherQueue.GetForCurrentThread().CreateTimer();
        _timer.Interval = TimeSpan.FromMilliseconds(160);
        _timer.Tick += (_, _) => {
            try { Refresh(); }
            catch (Exception ex) { AppLog.Write("desktop lyrics: " + ex); Dispose(); Notify.Show("桌面歌词暂时无法显示", true); }
        };
        _timer.Start();
        Refresh();
    }

    public void Refresh()
    {
        if (_timer is null) { Initialize(); return; }
        var config = ConfigService.Current;
        var media = MediaService.Instance;
        var settingsKey = $"{config.DesktopLyrics}|{config.LyricLocked}";
        if (_settingsKey != settingsKey) { _settingsKey = settingsKey; Changed?.Invoke(this, EventArgs.Empty); }
        if (!config.DesktopLyrics || !media.HasCurrent) { if (_window != IntPtr.Zero) ShowWindow(_window, 0); return; }
        EnsureWindow();
        if (_window == IntPtr.Zero) return;
        GetWindowRect(_window, out var rect);
        GetCursorPos(out var cursor);
        _hovered = _menuOpen || _resizing || (cursor.X >= rect.Left && cursor.X < rect.Right && cursor.Y >= rect.Top && cursor.Y < rect.Bottom);
        _hoverButton = _hovered ? HitButton(cursor.X - rect.Left, cursor.Y - rect.Top, rect.Right - rect.Left) : -1;
        // Poll the pointer even while locked. Only the unlock button receives input;
        // the lyrics and the rest of the transparent surface pass through to other apps.
        SetWindowLongPtr(_window, -20, new IntPtr(0x08080088 | (config.LyricLocked && _hoverButton != 6 && _pressedButton != 6 ? 0x20 : 0)));
        var index = media.ActiveLyricIndex;
        var first = string.IsNullOrWhiteSpace(media.ActiveLyric) ? media.Title + " · " + media.Singer : media.ActiveLyric;
        var second = index + 1 >= 0 && index + 1 < media.Lyrics.Count ? media.Lyrics[index + 1].Text : media.Singer;
        var progress = index >= 0 && index + 1 < media.Lyrics.Count
            ? Math.Clamp((media.Position.TotalMilliseconds + config.LyricOffset * 1000 - media.Lyrics[index].Time.TotalMilliseconds) / Math.Max(1, (media.Lyrics[index + 1].Time - media.Lyrics[index].Time).TotalMilliseconds), 0, 1) : 1;
        var key = $"{first}|{second}|{config.LyricStyle}|{config.LyricFontSize}|{config.LyricDoubleLine}|{config.LyricLocked}|{_hovered}|{_hoverButton}|{media.IsPlaying}|{rect.Right - rect.Left}|{(int)(progress * 80)}";
        if (key != _last) { _last = key; Render(first, second, progress); }
        ShowWindow(_window, 4); // SW_SHOWNOACTIVATE: lyrics never steal keyboard focus.
    }

    private void EnsureWindow()
    {
        if (_window != IntPtr.Zero) return;
        var wc = new WindowClass { Size = (uint)Marshal.SizeOf<WindowClass>(), Style = 8, Procedure = Marshal.GetFunctionPointerForDelegate(_proc), Instance = GetModuleHandle(null), ClassName = ClassName, Cursor = LoadCursor(IntPtr.Zero, new IntPtr(32512)) };
        RegisterClassEx(ref wc);
        SystemParametersInfo(48, 0, out var area, 0);
        var config = ConfigService.Current;
        var screenWidth = area.Right - area.Left;
        var width = Math.Clamp(config.LyricWidth ?? 940, Math.Min(DesktopLyricsGeometry.MinWidth, screenWidth), screenWidth);
        var x = Math.Clamp(config.LyricX ?? (area.Left + (area.Right - area.Left - width) / 2), area.Left, Math.Max(area.Left, area.Right - width));
        var height = DesktopLyricsGeometry.Height(config.LyricFontSize, config.LyricDoubleLine);
        var y = Math.Clamp(config.LyricY ?? area.Bottom - height - 32, area.Top, Math.Max(area.Top, area.Bottom - height));
        _window = CreateWindowEx(0x08080088, ClassName, "觅音桌面歌词", 0x80000000, x, y, width, height, IntPtr.Zero, IntPtr.Zero, wc.Instance, IntPtr.Zero);
    }

    private void Render(string current, string next, double progress)
    {
        var config = ConfigService.Current;
        GetWindowRect(_window, out var rect);
        var width = rect.Right - rect.Left;
        var fontSize = Math.Clamp(config.LyricFontSize, 24, 60);
        var height = DesktopLyricsGeometry.Height(fontSize, config.LyricDoubleLine);
        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppPArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.Transparent);
            // Alpha 1 provides a draggable hit surface without a visible backdrop.
            if (!config.LyricLocked) g.Clear(Color.FromArgb(1, 0, 0, 0));
            if (_hovered && !config.LyricLocked)
            {
                using var panel = new SolidBrush(Color.FromArgb(150, 24, 24, 26));
                using var rounded = new GraphicsPath();
                rounded.AddArc(4, 4, 32, 32, 180, 90); rounded.AddArc(width - 36, 4, 32, 32, 270, 90);
                rounded.AddArc(width - 36, height - 36, 32, 32, 0, 90); rounded.AddArc(4, height - 36, 32, 32, 90, 90); rounded.CloseFigure();
                g.FillPath(panel, rounded);
                using var grip = new Pen(Color.FromArgb(110, 235, 235, 235), 1.5f);
                g.DrawLine(grip, width - 14, height - 8, width - 8, height - 14);
                g.DrawLine(grip, width - 20, height - 8, width - 8, height - 20);
            }
            var colors = config.LyricStyle switch {
                "sky" => (Color.FromArgb(100, 222, 255), Color.FromArgb(183, 157, 255)),
                "rose" => (Color.FromArgb(255, 136, 191), Color.FromArgb(255, 215, 143)),
                "classic" => (Color.White, Color.White),
                "glass" => (Color.FromArgb(235, 240, 245), Color.White),
                _ => (Color.FromArgb(90, 255, 191), Color.FromArgb(255, 229, 128)) };
            DrawLine(g, current, new RectangleF(28, 48, width - 56, fontSize * 1.5f), fontSize, colors, progress);
            if (config.LyricDoubleLine) DrawLine(g, next, new RectangleF(28, fontSize * 1.5f + 48, width - 56, fontSize * 1.2f), fontSize * .7f, (Color.FromArgb(220, 230, 241), Color.FromArgb(220, 230, 241)), 1);
            if (_hovered)
            {
                string[] glyphs = ["\uE80F", "\uE892", MediaService.Instance.IsPlaying ? "\uE769" : "\uE768", "\uE893", "\uE72B", "\uE72A", config.LyricLocked ? "\uE785" : "\uE72E", "\uE713", "\uE711"];
                using var font = new Font("Segoe MDL2 Assets", 15, FontStyle.Regular, GraphicsUnit.Pixel);
                using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                for (var i = 0; i < ToolbarCount; i++)
                {
                    if (config.LyricLocked && i != 6) continue;
                    var box = ButtonRect(i, width);
                    using var hitSurface = new SolidBrush(Color.FromArgb(1, 0, 0, 0));
                    g.FillRectangle(hitSurface, box);
                    if (_hoverButton == i && !config.LyricLocked)
                    {
                        using var hover = new SolidBrush(Color.FromArgb(38, 255, 255, 255));
                        g.FillRectangle(hover, box);
                    }
                    using var ink = new SolidBrush(_hoverButton == i ? Color.FromArgb(255, 178, 110) : Color.FromArgb(240, 240, 240));
                    using var shadow = new SolidBrush(Color.FromArgb(210, 12, 12, 12));
                    var shadowBox = box; shadowBox.Offset(1, 1);
                    g.DrawString(glyphs[i], font, shadow, shadowBox, format);
                    g.DrawString(glyphs[i], font, ink, box, format);
                }
            }
        }
        var screen = GetDC(IntPtr.Zero);
        var memory = CreateCompatibleDC(screen);
        var info = new BitmapInfo { Size = 40, Width = width, Height = -height, Planes = 1, BitCount = 32 };
        var dib = CreateDIBSection(screen, ref info, 0, out var pixels, IntPtr.Zero, 0);
        var previous = IntPtr.Zero;
        try
        {
            if (dib == IntPtr.Zero) return;
            var data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            try { var bytes = new byte[data.Stride * height]; Marshal.Copy(data.Scan0, bytes, 0, bytes.Length); Marshal.Copy(bytes, 0, pixels, bytes.Length); }
            finally { bitmap.UnlockBits(data); }
            previous = SelectObject(memory, dib);
            var destination = new PointNative { X = rect.Left, Y = rect.Top };
            var size = new SizeNative { Width = width, Height = height };
            var origin = new PointNative();
            var blend = new Blend { Alpha = 255, Format = 1 };
            UpdateLayeredWindow(_window, screen, ref destination, ref size, memory, ref origin, 0, ref blend, 2);
        }
        finally { if (previous != IntPtr.Zero) SelectObject(memory, previous); if (dib != IntPtr.Zero) DeleteObject(dib); DeleteDC(memory); ReleaseDC(IntPtr.Zero, screen); }
    }

    private static void DrawLine(Graphics g, string text, RectangleF box, float size, (Color Start, Color End) colors, double progress)
    {
        using var path = new GraphicsPath();
        using var family = new FontFamily("Microsoft YaHei UI");
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, FormatFlags = StringFormatFlags.NoWrap };
        // Fit long lines instead of allowing the ends of the lyrics to be clipped.
        using var measure = new Font(family, size, FontStyle.Bold, GraphicsUnit.Pixel);
        var measured = g.MeasureString(text, measure).Width;
        if (measured > box.Width) size *= box.Width / measured;
        path.AddString(text, family, (int)FontStyle.Bold, size, box, format);
        using var outline = new Pen(Color.FromArgb(225, 10, 22, 31), 3.5f) { LineJoin = LineJoin.Round };
        g.DrawPath(outline, path);
        using var baseBrush = new SolidBrush(Color.FromArgb(230, 224, 234, 242)); g.FillPath(baseBrush, path);
        var bounds = path.GetBounds();
        var state = g.Save();
        g.SetClip(new RectangleF(bounds.X - 2, box.Y, (float)((bounds.Width + 4) * progress), box.Height));
        using var gradient = new LinearGradientBrush(box, colors.Start, colors.End, LinearGradientMode.Vertical);
        g.FillPath(gradient, path); g.Restore(state);
    }

    private static Rectangle ButtonRect(int index, int width) => DesktopLyricsControls.Bounds(index, width, ConfigService.Current.LyricLocked);

    private int HitButton(int x, int y, int width)
    {
        return DesktopLyricsControls.HitTest(x, y, width, ConfigService.Current.LyricLocked);
    }

    private void InvokeButton(int index)
    {
        var config = ConfigService.Current;
        if (!DesktopLyricsControls.CanInvoke(index, config.LyricLocked)) return;
        switch (index)
        {
            case 0: MainWindow.Instance.ShowFromTray(); return;
            case 1: MediaService.Instance.Previous(); return;
            case 2: _ = MediaService.Instance.PlayPauseAsync(); return;
            case 3: MediaService.Instance.Next(); return;
            case 4: config.LyricOffset = Math.Min(10, config.LyricOffset + .5); break;
            case 5: config.LyricOffset = Math.Max(-10, config.LyricOffset - .5); break;
            case 6: config.LyricLocked = !config.LyricLocked; break;
            case 7: ShowSettings(); return;
            case 8: config.DesktopLyrics = false; break;
            default: return;
        }
        ConfigService.Save(); Refresh();
    }

    public void ShowSettings()
    {
        var config = ConfigService.Current;
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return;
        _menuOpen = true;
        try
        {
            void Item(IntPtr parent, int id, string label, bool check = false) => AppendMenu(parent, check ? 8u : 0u, (UIntPtr)id, label);
            Item(menu, 1, "桌面歌词", config.DesktopLyrics);
            Item(menu, 2, "锁定", config.LyricLocked);
            Item(menu, 3, "双行", config.LyricDoubleLine);
            var sizes = CreatePopupMenu();
            int[] values = [24, 28, 32, 36, 40, 44, 48, 56, 60];
            foreach (var size in values) Item(sizes, 100 + size, size.ToString(), config.LyricFontSize == size);
            AppendMenu(menu, 0x10, (UIntPtr)sizes, "字号");
            var styles = CreatePopupMenu();
            string[] keys = ["emerald", "sky", "rose", "classic", "glass"];
            string[] names = ["翡翠", "晴空", "落霞", "白色", "柔白"];
            for (var i = 0; i < keys.Length; i++) Item(styles, 200 + i, names[i], config.LyricStyle == keys[i]);
            AppendMenu(menu, 0x10, (UIntPtr)styles, "配色");
            AppendMenu(menu, 0x800, UIntPtr.Zero, "");
            Item(menu, 4, "提前 0.5 秒"); Item(menu, 5, "延后 0.5 秒"); Item(menu, 6, "重置时间");
            GetCursorPos(out var point);
            var owner = WinRT.Interop.WindowNative.GetWindowHandle(MainWindow.Instance);
            SetForegroundWindow(owner);
            var command = TrackPopupMenu(menu, 0x102, point.X, point.Y, 0, owner, IntPtr.Zero);
            switch (command)
            {
                case 1: config.DesktopLyrics = !config.DesktopLyrics; break;
                case 2: config.LyricLocked = !config.LyricLocked; break;
                case 3: config.LyricDoubleLine = !config.LyricDoubleLine; break;
                case 4: config.LyricOffset = Math.Min(10, config.LyricOffset + .5); break;
                case 5: config.LyricOffset = Math.Max(-10, config.LyricOffset - .5); break;
                case 6: config.LyricOffset = 0; break;
                case >= 124 and <= 160: config.LyricFontSize = command - 100; break;
                case >= 200 and <= 204: config.LyricStyle = keys[command - 200]; break;
            }
            if (command != 0) ConfigService.Save();
        }
        finally { DestroyMenu(menu); _menuOpen = false; Refresh(); }
    }

    private void BeginResize(bool corner)
    {
        if (ConfigService.Current.LyricLocked) return;
        GetWindowRect(_window, out _resizeBounds);
        GetCursorPos(out _resizePointer);
        _resizeFontSize = ConfigService.Current.LyricFontSize;
        _resizeCorner = corner; _resizing = true; _pressedButton = -1;
        SetCapture(_window);
    }

    private void UpdateResize()
    {
        if (!_resizing) return;
        if (ConfigService.Current.LyricLocked) { FinishResize(); return; }
        GetCursorPos(out var cursor);
        var monitor = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(MonitorFromWindow(_window, 2), ref monitor))
            SystemParametersInfo(48, 0, out monitor.Work, 0);
        var size = DesktopLyricsGeometry.Resize(_resizeBounds.Right - _resizeBounds.Left, _resizeFontSize,
            ConfigService.Current.LyricDoubleLine, cursor.X - _resizePointer.X, cursor.Y - _resizePointer.Y,
            _resizeCorner, monitor.Work.Right - _resizeBounds.Left);
        ConfigService.Current.LyricFontSize = size.FontSize;
        ConfigService.Current.LyricWidth = size.Width;
        SetWindowPos(_window, IntPtr.Zero, 0, 0, size.Width, DesktopLyricsGeometry.Height(size.FontSize, ConfigService.Current.LyricDoubleLine), 0x16);
        Refresh();
    }

    private void FinishResize()
    {
        if (!_resizing) return;
        _resizing = false;
        ReleaseCapture();
        SavePlacement();
        Refresh();
    }

    private void SavePlacement()
    {
        GetWindowRect(_window, out var rect);
        ConfigService.Current.LyricX = rect.Left; ConfigService.Current.LyricY = rect.Top;
        ConfigService.Current.LyricWidth = rect.Right - rect.Left;
        ConfigService.Save();
    }

    private IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp)
    {
        if (msg == 0x84)
        {
            GetWindowRect(hwnd, out var bounds);
            var x = (short)(lp.ToInt64() & 0xffff) - bounds.Left;
            var y = (short)((lp.ToInt64() >> 16) & 0xffff) - bounds.Top;
            if (HitButton(x, y, bounds.Right - bounds.Left) >= 0) return new IntPtr(1);
            var edge = DesktopLyricsGeometry.ResizeHitTest(x, y, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top, ConfigService.Current.LyricLocked);
            if (edge != 0) return new IntPtr(edge);
            return new IntPtr(ConfigService.Current.LyricLocked ? -1 : 2);
        }
        if (msg == 0x20 && !ConfigService.Current.LyricLocked)
        {
            var hit = (int)(lp.ToInt64() & 0xffff);
            if (hit is DesktopLyricsGeometry.Right or DesktopLyricsGeometry.BottomRight)
            {
                SetCursor(LoadCursor(IntPtr.Zero, new IntPtr(hit == DesktopLyricsGeometry.Right ? 32644 : 32642)));
                return new IntPtr(1);
            }
        }
        if (msg == 0xA1 && wp.ToInt64() is DesktopLyricsGeometry.Right or DesktopLyricsGeometry.BottomRight)
        {
            BeginResize(wp.ToInt64() == DesktopLyricsGeometry.BottomRight);
            return IntPtr.Zero;
        }
        if (msg == 0x200 && _resizing) { UpdateResize(); return IntPtr.Zero; }
        if (msg == 0x201)
        {
            GetWindowRect(hwnd, out var bounds);
            _pressedButton = HitButton((short)(lp.ToInt64() & 0xffff), (short)((lp.ToInt64() >> 16) & 0xffff), bounds.Right - bounds.Left);
            if (_pressedButton >= 0) SetCapture(hwnd);
            return IntPtr.Zero;
        }
        if (msg == 0x202)
        {
            if (_resizing) { UpdateResize(); FinishResize(); return IntPtr.Zero; }
            GetWindowRect(hwnd, out var bounds);
            var released = HitButton((short)(lp.ToInt64() & 0xffff), (short)((lp.ToInt64() >> 16) & 0xffff), bounds.Right - bounds.Left);
            var pressed = _pressedButton;
            _pressedButton = -1;
            ReleaseCapture();
            if (released == pressed) InvokeButton(released);
            return IntPtr.Zero;
        }
        if (msg is 0x215 or 0x1F) { _pressedButton = -1; FinishResize(); }
        if (msg is 0x00A4 or 0x205 && !ConfigService.Current.LyricLocked) { ShowSettings(); return IntPtr.Zero; }
        if (msg == 0x00A3 && !ConfigService.Current.LyricLocked) { _ = MediaService.Instance.PlayPauseAsync(); return IntPtr.Zero; }
        if (msg == 0x232) SavePlacement();
        return DefWindowProc(hwnd, msg, wp, lp);
    }
    public void Dispose() { _last = ""; _timer?.Stop(); _timer = null; if (_window != IntPtr.Zero) DestroyWindow(_window); _window = IntPtr.Zero; }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate IntPtr WindowProc(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct WindowClass { public uint Size, Style; public IntPtr Procedure; public int ClassExtra, WindowExtra; public IntPtr Instance, Icon, Cursor, Background; public string? MenuName; public string ClassName; public IntPtr SmallIcon; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct PointNative { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct SizeNative { public int Width, Height; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public uint Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct Blend { public byte Operation, Flags, Alpha, Format; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo { public uint Size; public int Width, Height; public ushort Planes, BitCount; public uint Compression, ImageSize; public int XPels, YPels; public uint Colors, Important; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassEx(ref WindowClass wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")] private static extern IntPtr LoadCursor(IntPtr instance, IntPtr cursor);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint param, out Rect area, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr dc, ref PointNative dest, ref SizeNative size, IntPtr source, ref PointNative origin, uint key, ref Blend blend, uint flags);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out PointNative point);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(IntPtr menu, uint flags, UIntPtr id, string text);
    [DllImport("user32.dll")] private static extern int TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr owner, IntPtr rect);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr SetCapture(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
}
