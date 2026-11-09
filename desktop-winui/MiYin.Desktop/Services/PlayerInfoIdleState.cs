namespace MiYin.Desktop.Services;

public sealed class PlayerInfoIdleState
{
    public static readonly TimeSpan Delay = TimeSpan.FromSeconds(5);
    private readonly TimeSpan _delay;
    public PlayerInfoIdleState(TimeSpan? delay = null) => _delay = delay ?? Delay;
    private TimeSpan? _leftAt;

    public bool Update(bool pointerInside, bool lyricsAvailable, TimeSpan now)
    {
        if (pointerInside) { _leftAt = null; return false; }
        _leftAt ??= now;
        return lyricsAvailable && now - _leftAt.Value >= _delay;
    }
}
