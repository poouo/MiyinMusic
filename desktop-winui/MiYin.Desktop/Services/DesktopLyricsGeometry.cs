namespace MiYin.Desktop.Services;

public static class DesktopLyricsGeometry
{
    public const int Right = 11, BottomRight = 17, MinWidth = 360;
    public static int Height(int fontSize, bool doubleLine) =>
        (int)Math.Ceiling(Math.Clamp(fontSize, 24, 60) * (doubleLine ? 2.7 : 1.5)) + 64;

    public static int ResizeHitTest(int x, int y, int width, int height, bool locked)
    {
        if (locked || x < 0 || y < 0 || x >= width || y >= height) return 0;
        if (x >= width - 20 && y >= height - 20) return BottomRight;
        return x >= width - 10 ? Right : 0;
    }

    public static (int Width, int FontSize) Resize(int startWidth, int startFontSize, bool doubleLine,
        int deltaX, int deltaY, bool corner, int maxWidth)
    {
        maxWidth = Math.Max(1, maxWidth);
        var width = Math.Clamp(startWidth + deltaX, Math.Min(MinWidth, maxWidth), maxWidth);
        var font = corner ? (int)Math.Round(startFontSize + deltaY / (doubleLine ? 2.7 : 1.5)) : startFontSize;
        return (width, Math.Clamp(font, 24, 60));
    }
}
