using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MiYin.Desktop.Models;
using Windows.Storage;

namespace MiYin.Desktop.Services;

public sealed class LocalMusicService
{
    public static LocalMusicService Instance { get; } = new();
    public sealed class Track { public Song Song { get; set; } = new(); public string Path { get; set; } = ""; }
    private readonly Dictionary<string, Track> _tracks = new();
    private static string IndexFile => System.IO.Path.Combine(AppInfo.DataDirectory, "local-music.json");
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".mp3", ".flac", ".m4a", ".wav", ".ogg", ".aac", ".wma" };
    public IEnumerable<Song> Songs => _tracks.Values.Where(track => File.Exists(track.Path)).Select(track => track.Song).OrderBy(song => song.Name);
    private LocalMusicService()
    {
        try { foreach (var track in JsonSerializer.Deserialize<List<Track>>(File.ReadAllText(IndexFile)) ?? new()) _tracks[track.Song.Key] = track; } catch { }
    }
    public bool TryGetPath(string key, out string path)
    {
        path = _tracks.TryGetValue(key, out var track) && File.Exists(track.Path) ? track.Path : "";
        return path.Length > 0;
    }
    public async Task<int> ScanAsync(string folder)
    {
        var files = await Task.Run(() => Directory.EnumerateFiles(folder, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = System.IO.FileAttributes.ReparsePoint }).Where(path => Extensions.Contains(System.IO.Path.GetExtension(path))).Take(5000).ToList());
        var count = 0;
        foreach (var path in files)
        {
            try
            {
                var file = await StorageFile.GetFileFromPathAsync(path);
                var tags = await file.Properties.GetMusicPropertiesAsync();
                var song = new Song { Platform = "local", SongMid = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(path).ToUpperInvariant()))), Name = string.IsNullOrWhiteSpace(tags.Title) ? System.IO.Path.GetFileNameWithoutExtension(path) : tags.Title, Singer = tags.Artist, AlbumName = tags.Album, Interval = (int)tags.Duration.TotalSeconds };
                _tracks[song.Key] = new Track { Song = song, Path = path }; count++;
            }
            catch { /* Unsupported or inaccessible files do not stop the scan. */ }
        }
        Directory.CreateDirectory(AppInfo.DataDirectory);
        File.WriteAllText(IndexFile + ".tmp", JsonSerializer.Serialize(_tracks.Values));
        File.Move(IndexFile + ".tmp", IndexFile, true);
        return count;
    }
    public void ClearIndex()
    {
        _tracks.Clear();
        Directory.CreateDirectory(AppInfo.DataDirectory);
        File.WriteAllText(IndexFile, "[]");
    }
}
