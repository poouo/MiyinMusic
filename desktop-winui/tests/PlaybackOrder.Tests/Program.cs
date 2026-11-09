using MiYin.Desktop.Services;

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new Exception($"Expected {expected}, got {actual}");
}

Equal("all", PlaybackOrder.NextMode("off"));
Equal("one", PlaybackOrder.NextMode("all"));
Equal("shuffle", PlaybackOrder.NextMode("one"));
Equal("off", PlaybackOrder.NextMode("shuffle"));
Equal("shuffle", PlaybackOrder.Mode("one", true));
Equal(-1, PlaybackOrder.NextIndex(2, 3, "off", false));
Equal(0, PlaybackOrder.NextIndex(2, 3, "off", true));
Equal(0, PlaybackOrder.NextIndex(2, 3, "all", false));
Equal(1, PlaybackOrder.NextIndex(1, 3, "one", false));
Equal(2, PlaybackOrder.NextIndex(1, 3, "one", true));
Equal(-1, PlaybackOrder.NextIndex(0, 0, "all", false));
for (var count = 2; count <= 40; count++)
for (var index = 0; index < count; index++)
for (var slot = 0; slot < count - 1; slot++)
{
    var next = PlaybackOrder.NextIndex(index, count, "shuffle", false, _ => slot);
    if (next == index || next < 0 || next >= count) throw new Exception("Invalid shuffle destination");
}
Equal(0, PlaybackOrder.NextIndex(0, 1, "shuffle", false));
Console.WriteLine("Playback mode, end-of-queue, manual skip and shuffle regressions passed");

// An explicit selection may fall back, but must never silently upgrade or use
// an old lower-quality download in place of resolving the requested source.
Equal("320k,128k", string.Join(",", PlaybackQuality.Order(["flac", "320k", "128k"], "320k")));
Equal("128k", string.Join(",", PlaybackQuality.Order(["flac", "320k"], "128k")));
Equal("flac,320k,128k", string.Join(",", PlaybackQuality.Order(["flac", "320k", "128k"], "auto")));
Equal(false, PlaybackQuality.CanReuse("128k", ["320k", "128k"], true));
Equal(false, PlaybackQuality.CanReuse("", ["320k", "128k"], true));
Equal(true, PlaybackQuality.CanReuse("320k", ["320k", "128k"], true));
Equal(true, PlaybackQuality.CanReuse("128k", ["flac", "320k", "128k"], false));
Equal(false, PlaybackQuality.Covers("128k", "320k"));
Equal(true, PlaybackQuality.Covers("flac", "320k"));
Equal(true, PlaybackQuality.Covers("320k", "320k"));
Console.WriteLine("Quality selection, fallback and cache upgrade regressions passed");

// Locked lyrics expose only the centered unlock button, even where a playback
// or settings button was shown before locking. The lyric area stays passive.
foreach (var width in new[] { 320, 640, 940 })
{
    for (var i = 0; i < DesktopLyricsControls.Count; i++)
    {
        var box = DesktopLyricsControls.Bounds(i, width, false);
        Equal(i, DesktopLyricsControls.HitTest(box.Left + box.Width / 2, box.Top + box.Height / 2, width, false));
        Equal(i == DesktopLyricsControls.Lock, DesktopLyricsControls.CanInvoke(i, true));
    }
    for (var x = 0; x < width; x++)
    {
        var unlock = DesktopLyricsControls.Bounds(DesktopLyricsControls.Lock, width, true);
        Equal(unlock.Contains(x, 24) ? DesktopLyricsControls.Lock : -1, DesktopLyricsControls.HitTest(x, 24, width, true));
        Equal(-1, DesktopLyricsControls.HitTest(x, 70, width, true));
    }
}
Console.WriteLine("Desktop lyrics lock, unlock and pointer hit-area regressions passed");

var idle = new PlayerInfoIdleState(TimeSpan.FromSeconds(8));
Equal(false, idle.Update(false, true, TimeSpan.Zero));
Equal(false, idle.Update(false, true, TimeSpan.FromSeconds(7.9)));
Equal(true, idle.Update(false, true, TimeSpan.FromSeconds(8)));
Equal(false, idle.Update(true, true, TimeSpan.FromSeconds(8.1)));
Equal(false, idle.Update(false, true, TimeSpan.FromSeconds(9)));
Equal(false, idle.Update(false, false, TimeSpan.FromSeconds(20)));
Equal(true, idle.Update(false, true, TimeSpan.FromSeconds(20)));
Equal(false, idle.Update(true, true, TimeSpan.FromSeconds(21)));
Equal(false, idle.Update(false, true, TimeSpan.FromSeconds(22)));
Equal(false, idle.Update(false, true, TimeSpan.FromSeconds(29)));
Equal(DesktopLyricsGeometry.Right, DesktopLyricsGeometry.ResizeHitTest(635, 80, 640, 162, false));
Equal(DesktopLyricsGeometry.BottomRight, DesktopLyricsGeometry.ResizeHitTest(630, 155, 640, 162, false));
Equal(0, DesktopLyricsGeometry.ResizeHitTest(630, 155, 640, 162, true));
Equal(0, DesktopLyricsGeometry.ResizeHitTest(300, 80, 640, 162, false));
Equal((360, 24), DesktopLyricsGeometry.Resize(640, 36, true, -900, -900, true, 1920));
Equal((1920, 60), DesktopLyricsGeometry.Resize(640, 36, true, 3000, 900, true, 1920));
Equal((740, 36), DesktopLyricsGeometry.Resize(640, 36, true, 100, 100, false, 1920));
Equal((300, 36), DesktopLyricsGeometry.Resize(640, 36, true, 100, 100, false, 300));
Console.WriteLine("Idle restore, resize edges, locked hit areas and geometry limits passed");
