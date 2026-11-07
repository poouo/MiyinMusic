using MiYin.Desktop.Models;
using MiYin.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace MiYin.Desktop.Views;

public sealed partial class ChartsPage : Page
{
    private List<ChartInfo> _charts = new();
    private readonly List<string> _platforms = new() { "all" };
    private string _platform = "all";
    private bool _ready;

    public ChartsPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        LoadingRing.IsActive = true;
        try
        {
            var result = await ApiService.GetChartsAsync();
            _charts = result.Charts;
            _platforms.Clear();
            _platforms.Add("all");
            PlatformBox.Items.Clear();
            PlatformBox.Items.Add(new ComboBoxItem { Content = "全部平台", Tag = "all" });
            foreach (var group in _charts.GroupBy(chart => chart.Platform))
            {
                _platforms.Add(group.Key);
                PlatformBox.Items.Add(new ComboBoxItem { Content = PlatformInfo.FullName(group.Key), Tag = group.Key });
            }
            _ready = true;
            PlatformBox.SelectedIndex = 0;
            ApplyFilter();
            SubtitleText.Text = $"共 {_charts.Count} 个榜单 · 网易云、QQ 音乐、酷我、酷狗";
        }
        catch (Exception ex)
        {
            SubtitleText.Text = "榜单加载失败：" + ex.Message;
        }
        finally
        {
            LoadingRing.IsActive = false;
        }
    }

    private void PlatformBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || PlatformBox.SelectedItem is not ComboBoxItem item) return;
        _platform = item.Tag as string ?? "all";
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        var list = _platform == "all" ? MixCharts(_charts) : _charts.Where(chart => chart.Platform == _platform).ToList();
        ChartGrid.ItemsSource = list;
    }

    private static List<ChartInfo> MixCharts(List<ChartInfo> charts)
    {
        var groups = charts.GroupBy(chart => chart.Platform).Select(group => group.ToList()).ToList();
        var result = new List<ChartInfo>();
        for (var round = 0; round < 20 && result.Count < charts.Count; round++)
        {
            foreach (var group in groups)
            {
                if (round < group.Count) result.Add(group[round]);
            }
        }
        return result;
    }

    private void ChartGrid_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is ChartInfo chart)
            MainWindow.Instance.NavigateTo(typeof(SongsPage), chart);
    }
}
