namespace MiYin.Desktop.Services;

public static class PlaybackQuality
{
    private static readonly string[] Ladder = ["flac24bit", "flac", "320k", "128k"];
    public static bool IsKnown(string quality) => Ladder.Contains(quality);

    public static List<string> Order(IEnumerable<string> preferences, string? requested = null)
    {
        var index = Array.IndexOf(Ladder, requested);
        if (index >= 0) return Ladder.Skip(index).ToList();
        var result = preferences.Where(Ladder.Contains).Distinct().ToList();
        return result.Count > 0 ? result : ["320k", "128k"];
    }

    public static bool CanReuse(string stored, IReadOnlyList<string> preferred, bool changingQuality) =>
        !changingQuality || (preferred.Count > 0 && stored == preferred[0]);

    public static bool Covers(string stored, string incoming)
    {
        var existing = Array.IndexOf(Ladder, stored);
        var requested = Array.IndexOf(Ladder, incoming);
        return existing >= 0 && requested >= 0 && existing <= requested;
    }

    public static string Name(string quality) => quality switch
    {
        "flac24bit" => "Hi-Res 无损",
        "flac" => "无损 SQ",
        "320k" => "高品质 HQ（320 kbps）",
        "128k" => "标准音质（128 kbps）",
        "" => "尚未加载",
        _ => quality,
    };
}
