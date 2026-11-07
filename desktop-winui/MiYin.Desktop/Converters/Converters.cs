using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.UI;

namespace MiYin.Desktop.Converters;

public sealed class CoverBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var url = value as string;
        if (string.IsNullOrWhiteSpace(url))
        {
            return new LinearGradientBrush
            {
                StartPoint = new Windows.Foundation.Point(0, 0),
                EndPoint = new Windows.Foundation.Point(1, 1),
                GradientStops =
                {
                    new GradientStop { Color = Color.FromArgb(255, 32, 39, 56), Offset = 0 },
                    new GradientStop { Color = Color.FromArgb(255, 22, 27, 39), Offset = 1 },
                },
            };
        }
        var bitmap = new BitmapImage();
        try
        {
            bitmap.UriSource = new Uri(url);
            bitmap.DecodePixelWidth = 420;
        }
        catch
        {
            /* 无效地址时显示占位色 */
        }
        return new ImageBrush { ImageSource = bitmap, Stretch = Stretch.UniformToFill };
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}

public sealed class PlatformBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var platform = value as string ?? "";
        var (from, to) = platform switch
        {
            "kw" => (Color.FromArgb(255, 178, 78, 232), Color.FromArgb(255, 106, 28, 168)),
            "kg" => (Color.FromArgb(255, 168, 180, 60), Color.FromArgb(255, 88, 100, 18)),
            "tx" => (Color.FromArgb(255, 63, 208, 124), Color.FromArgb(255, 24, 132, 78)),
            "wy" => (Color.FromArgb(255, 255, 93, 108), Color.FromArgb(255, 162, 34, 52)),
            "mg" => (Color.FromArgb(255, 79, 140, 255), Color.FromArgb(255, 33, 79, 176)),
            _ => (Color.FromArgb(255, 125, 139, 255), Color.FromArgb(255, 76, 86, 168)),
        };
        return new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = from, Offset = 0 },
                new GradientStop { Color = to, Offset = 1 },
            },
        };
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}

public sealed class QualityBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var quality = value as string ?? "";
        var color = quality switch
        {
            "Hi-Res" => Color.FromArgb(255, 58, 46, 18),
            "SQ" => Color.FromArgb(255, 18, 51, 44),
            "HQ" => Color.FromArgb(255, 20, 42, 62),
            _ => Color.FromArgb(255, 22, 27, 39),
        };
        return new SolidColorBrush(color);
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}

public sealed class QualityForegroundConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var quality = value as string ?? "";
        var color = quality switch
        {
            "Hi-Res" => Color.FromArgb(255, 245, 196, 92),
            "SQ" => Color.FromArgb(255, 70, 214, 178),
            "HQ" => Color.FromArgb(255, 96, 186, 255),
            _ => Color.FromArgb(255, 154, 166, 188),
        };
        return new SolidColorBrush(color);
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}

public sealed class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var flag = value is bool b && b;
        if (parameter is string text && text.Equals("invert", StringComparison.OrdinalIgnoreCase)) flag = !flag;
        return flag ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        value is Visibility.Visible;
}

public sealed class StringToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language) =>
        string.IsNullOrWhiteSpace(value as string) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}

public sealed class BoolToActiveBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var active = value is bool b && b;
        return new SolidColorBrush(active ? Color.FromArgb(255, 47, 208, 127) : Color.FromArgb(255, 154, 166, 188));
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}

public sealed class BoolToOpacityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language) =>
        value is bool b && b ? 1.0 : 0.45;

    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException();
}
