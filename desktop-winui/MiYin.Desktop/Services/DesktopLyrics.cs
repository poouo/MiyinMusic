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
    private const string ClassName = "MiYinDesktopLyrics";
    private DesktopLyrics() { _proc = WndProc; }

    public void Initialize()
    {
        if (_timer is not null) return;
        _timer = DispatcherQueue.GetForCurrentThread().CreateTimer();
        _timer.Interval = TimeSpan.FromMilliseconds(160);
        _timer.Tick += (_, _) => {
            try { Refresh(); }
            catch (Exception ex) { AppLog.Write("desktop lyrics: " + ex); Dispose(); Notify.Show("桌面歌词暂时无法显示，可在设置中重新开启", true); }
        };
        _timer.Start();
        Refresh();
    }

    public void Refresh()
    {
        if (_timer is null) { Initialize(); return; }
        var config = ConfigService.Current;
        var media = MediaService.Instance;
        if (!config.DesktopLyrics || !media.HasCurrent) { if (_window != IntPtr.Zero) ShowWindow(_window, 0); return; }
        EnsureWindow();
        if (_window == IntPtr.Zero) return;
        SetWindowLongPtr(_window, -20, new IntPtr(0x00080000 | 0x08000000 | 0x00000080 | 0x00000008 | (config.LyricLocked ? 0x20 : 0)));
        var index = media.ActiveLyricIndex;
        var first = string.IsNullOrWhiteSpace(media.ActiveLyric) ? media.Title + " · " + media.Singer : media.ActiveLyric;
        var second = index + 1 >= 0 && index + 1 < media.Lyrics.Count ? media.Lyrics[index + 1].Text : media.Singer;
        var progress = index >= 0 && index + 1 < media.Lyrics.Count
            ? Math.Clamp((media.Position - media.Lyrics[index].Time).TotalMilliseconds / Math.Max(1, (media.Lyrics[index + 1].Time - media.Lyrics[index].Time).TotalMilliseconds), 0, 1) : 1;
        var key = $"{first}|{second}|{config.LyricStyle}|{config.LyricFontSize}|{config.LyricDoubleLine}|{config.LyricLocked}|{(int)(progress * 80)}";
        if (key != _last) { _last = key; Render(first, second, progress); }
        ShowWindow(_window, 4); // SW_SHOWNOACTIVATE: lyrics never steal keyboard focus.
    }

    private void EnsureWindow()
    {
        if (_window != IntPtr.Zero) return;
        var wc = new WindowClass { Size = (uint)Marshal.SizeOf<WindowClass>(), Style = 8, Procedure = Marshal.GetFunctionPointerForDelegate(_proc), Instance = GetModuleHandle(null), ClassName = ClassName, Cursor = LoadCursor(IntPtr.Zero, new IntPtr(32512)) };
        RegisterClassEx(ref wc);
        SystemParametersInfo(48, 0, out var area, 0);
        var width = Math.Min(940, area.Right - area.Left);
        var config = ConfigService.Current;
        var x = Math.Clamp(config.LyricX ?? (area.Left + (area.Right - area.Left - width) / 2), area.Left, Math.Max(area.Left, area.Right - width));
        var y = Math.Clamp(config.LyricY ?? area.Bottom - 220, area.Top, Math.Max(area.Top, area.Bottom - 200));
        _window = CreateWindowEx(0x08080088, ClassName, "觅音桌面歌词", 0x80000000, x, y, width, 180, IntPtr.Zero, IntPtr.Zero, wc.Instance, IntPtr.Zero);
    }

    private void Render(string current, string next, double progress)
    {
        var config = ConfigService.Current;
        GetWindowRect(_window, out var rect);
        var width = rect.Right - rect.Left;
        var fontSize = Math.Clamp(config.LyricFontSize, 24, 60);
        var height = fontSize * (config.LyricDoubleLine ? 3 : 2) + 30;
        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppPArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            // The glass preset has a translucent backing; other presets are floating outlined text.
            if (config.LyricStyle == "glass")
            {
                using var panel = new SolidBrush(Color.FromArgb(190, 18, 28, 34));
                using var rounded = new GraphicsPath();
                rounded.AddArc(4, 4, 32, 32, 180, 90); rounded.AddArc(width - 36, 4, 32, 32, 270, 90);
                rounded.AddArc(width - 36, height - 36, 32, 32, 0, 90); rounded.AddArc(4, height - 36, 32, 32, 90, 90); rounded.CloseFigure();
                g.FillPath(panel, rounded);
            }
            var colors = config.LyricStyle switch {
                "sky" => (Color.FromArgb(100, 222, 255), Color.FromArgb(183, 157, 255)),
                "rose" => (Color.FromArgb(255, 136, 191), Color.FromArgb(255, 215, 143)),
                "classic" => (Color.White, Color.White),
                _ => (Color.FromArgb(90, 255, 191), Color.FromArgb(255, 229, 128)) };
            DrawLine(g, current, new RectangleF(28, 16, width - 56, fontSize * 1.5f), fontSize, colors, progress);
            if (config.LyricDoubleLine) DrawLine(g, next, new RectangleF(28, fontSize * 1.5f + 16, width - 56, fontSize * 1.2f), fontSize * .7f, (Color.FromArgb(220, 230, 241), Color.FromArgb(220, 230, 241)), 1);
            if (!config.LyricLocked)
            {
                using var font = new Font("Microsoft YaHei UI", 9);
                using var brush = new SolidBrush(Color.FromArgb(200, 235, 240, 245));
                g.DrawString("拖动移动 · 右键锁定 · 双击播放/暂停", font, brush, 16, height - 24);
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

    private IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp)
    {
        if (msg == 0x84) return new IntPtr(ConfigService.Current.LyricLocked ? -1 : 2);
        if (msg == 0x00A4) { ConfigService.Current.LyricLocked = true; ConfigService.Save(); _last = ""; Refresh(); return IntPtr.Zero; }
        if (msg == 0x00A3) { _ = MediaService.Instance.PlayPauseAsync(); return IntPtr.Zero; }
        if (msg == 0x232) { GetWindowRect(hwnd, out var rect); ConfigService.Current.LyricX = rect.Left; ConfigService.Current.LyricY = rect.Top; ConfigService.Save(); }
        return DefWindowProc(hwnd, msg, wp, lp);
    }
    public void Dispose() { _last = ""; _timer?.Stop(); _timer = null; if (_window != IntPtr.Zero) DestroyWindow(_window); _window = IntPtr.Zero; }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate IntPtr WindowProc(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct WindowClass { public uint Size, Style; public IntPtr Procedure; public int ClassExtra, WindowExtra; public IntPtr Instance, Icon, Cursor, Background; public string? MenuName; public string ClassName; public IntPtr SmallIcon; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct PointNative { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct SizeNative { public int Width, Height; }
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
}
