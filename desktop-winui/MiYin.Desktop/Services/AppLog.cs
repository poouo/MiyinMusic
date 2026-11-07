using System.Text;

namespace MiYin.Desktop.Services;

public static class AppLog
{
    private static readonly object Gate = new();

    public static string FilePath => Path.Combine(AppInfo.DataDirectory, "client.log");

    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(AppInfo.DataDirectory);
            lock (Gate)
            {
                var file = new FileInfo(FilePath);
                if (file.Exists && file.Length > 2_000_000)
                {
                    File.Move(FilePath, FilePath + ".old", true);
                }
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}", Encoding.UTF8);
            }
        }
        catch
        {
            /* 日志失败不影响播放 */
        }
    }
}
