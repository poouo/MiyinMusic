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
        "AppBgBrush" => Hex(light ? "#F5F7FC" : "#0A0C12"),
        "SidebarBrush" => Hex(light ? "#EDF1F8" : "#0C0F17"),
        "PlayerBrush" => Hex(light ? "#FFFFFF" : "#0E111A"),
        "CardBrush" => Hex(light ? "#FFFFFF" : "#141824"),
        "CardHoverBrush" => Hex(light ? "#F1F4FA" : "#1B2030"),
        "LineBrush" => Hex(light ? "#DCE3EF" : "#232A3A"),
        "TextBrush" => Hex(light ? "#182033" : "#EEF2F8"),
        "TextDimBrush" => Hex(light ? "#5C687C" : "#9AA6BC"),
        "TextFaintBrush" => Hex(light ? "#8A95A8" : "#6B7690"),
        "AccentBrush" => Hex(light ? "#0D9F63" : "#2FD07F"),
        "AccentSoftBrush" => Hex(light ? "#E0F5E9" : "#162A22"),
        "Accent2Brush" => Hex(light ? "#2E7FE8" : "#57B6FF"),
        "PinkBrush" => Hex(light ? "#D9476C" : "#FF5D8F"),
        "GoldBrush" => Hex(light ? "#B07A12" : "#F5C45C"),
        "RowHoverBrush" => Hex(light ? "#EDF2FA" : "#151A26"),
        "BadgeBrush" => Hex(light ? "#EEFFFFFF" : "#99000000"),
        "WhiteBrush" => Hex("#FFFFFF"),
        "BlackBrush" => Hex(light ? "#101827" : "#060A08"),
        _ => Hex("#9AA6BC"),
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
