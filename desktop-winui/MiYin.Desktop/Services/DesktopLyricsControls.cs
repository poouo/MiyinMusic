using System.Drawing;

namespace MiYin.Desktop.Services;

public static class DesktopLyricsControls
{
    public const int Count = 9, Lock = 6, Size = 32;

    public static Rectangle Bounds(int index, int width, bool locked) =>
        new(locked ? (width - Size) / 2 : (width - Size * Count) / 2 + index * Size, 8, Size, Size);

    public static bool CanInvoke(int index, bool locked) =>
        index >= 0 && index < Count && (!locked || index == Lock);

    public static int HitTest(int x, int y, int width, bool locked)
    {
        for (var i = 0; i < Count; i++)
            if (CanInvoke(i, locked) && Bounds(i, width, locked).Contains(x, y)) return i;
        return -1;
    }
}
