using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace MiYin.Desktop.Services;

/// <summary>给代码里动态设置的画刷提供当前主题颜色（XAML 使用 ThemeResource）。</summary>
public static class ThemeService
{
    public static ElementTheme Current { get; private set; } = ElementTheme.Dark;

    public static void Set(ElementTheme theme) => Current = theme == ElementTheme.Default ? ElementTheme.Dark : theme;

    public static Brush Brush(string key)
    {
        var light = Current == ElementTheme.Light;
        return new SolidColorBrush(ColorFor(key, light));
    }

    private static Color ColorFor(string key, bool light) => key switch
    {
        "AppBgBrush" => Hex(light ? "#FAF9F6" : "#151515"),
        "SidebarBrush" => Hex(light ? "#F0EEEA" : "#191919"),
        "PlayerBrush" => Hex(light ? "#FFFFFF" : "#1B1B1B"),
        "CardBrush" => Hex(light ? "#FFFFFF" : "#202020"),
        "CardHoverBrush" => Hex(light ? "#F4F2ED" : "#282828"),
        "LineBrush" => Hex(light ? "#DEDAD2" : "#343434"),
        "TextBrush" => Hex(light ? "#252321" : "#F0EEEA"),
        "TextDimBrush" => Hex(light ? "#66615B" : "#B4B1AC"),
        "TextFaintBrush" => Hex(light ? "#716A61" : "#A4A19C"),
        "AccentBrush" => Hex(light ? "#A64B22" : "#E8A06F"),
        "AccentSoftBrush" => Hex(light ? "#F6E6DB" : "#352B24"),
        "Accent2Brush" => Hex(light ? "#2E7FE8" : "#57B6FF"),
        "PinkBrush" => Hex(light ? "#D9476C" : "#FF5D8F"),
        "GoldBrush" => Hex(light ? "#B07A12" : "#F5C45C"),
        "RowHoverBrush" => Hex(light ? "#F0EDE7" : "#272727"),
        "BadgeBrush" => Hex(light ? "#EEFFFFFF" : "#99000000"),
        "WhiteBrush" => Hex("#FFFFFF"),
        "BlackBrush" => Hex(light ? "#101827" : "#060A08"),
        _ => Hex("#B4B1AC"),
    };

    private static Color Hex(string value)
    {
        var text = value.TrimStart('#');
        if (text.Length == 8)
        {
            return Color.FromArgb(
                Convert.ToByte(text[..2], 16),
                Convert.ToByte(text[2..4], 16),
                Convert.ToByte(text[4..6], 16),
                Convert.ToByte(text[6..8], 16));
        }
        return Color.FromArgb(
            255,
            Convert.ToByte(text[..2], 16),
            Convert.ToByte(text[2..4], 16),
            Convert.ToByte(text[4..6], 16));
    }
}
