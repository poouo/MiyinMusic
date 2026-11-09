using System.Text.Json.Serialization;
namespace MiYin.Desktop.Models;
public sealed class ArtistRef
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
}
public sealed class AlbumDetail
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("singer")] public string Singer { get; set; } = "";
    [JsonPropertyName("cover")] public string? Cover { get; set; }
    [JsonPropertyName("songs")] public List<Song> Songs { get; set; } = new();
}
public sealed class Recommendation
{
    [JsonPropertyName("song")] public Song Song { get; set; } = new();
    [JsonPropertyName("reason")] public string Reason { get; set; } = "";
}
public sealed class Recommendations
{
    [JsonPropertyName("items")] public List<Recommendation> Items { get; set; } = new();
}
