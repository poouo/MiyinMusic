namespace MiYin.Desktop.Services;

/// <summary>Playback transitions shared by user controls and automatic track completion.</summary>
public static class PlaybackOrder
{
    public static string Mode(string repeat, bool shuffle) => shuffle ? "shuffle" : repeat;

    public static string NextMode(string mode) => mode switch
    {
        "off" => "all",
        "all" => "one",
        "one" => "shuffle",
        _ => "off",
    };

    public static int NextIndex(int index, int count, string mode, bool manual,
        Func<int, int>? random = null)
    {
        if (count <= 0) return -1;
        if (mode == "one" && !manual) return index;
        if (mode == "shuffle" && count > 1)
        {
            var slot = (random ?? Random.Shared.Next)(count - 1);
            return slot >= index ? slot + 1 : slot;
        }
        if (index + 1 < count) return index + 1;
        return mode != "off" || manual ? 0 : -1;
    }
}
