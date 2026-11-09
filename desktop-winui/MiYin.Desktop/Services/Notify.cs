namespace MiYin.Desktop.Services;

public sealed class NotifyEventArgs : EventArgs
{
    public string Message { get; init; } = "";
    public bool IsError { get; init; }
}

public static class Notify
{
    public static event EventHandler<NotifyEventArgs>? Shown;

    public static void Show(string message, bool isError = false)
    {
        if (System.Text.RegularExpressions.Regex.IsMatch(message, @"(?i)https?://|music\.poouo\.com|/api/"))
            message = isError ? "连接暂不可用，请检查网络后重试" : "操作已完成";
        Shown?.Invoke(null, new NotifyEventArgs { Message = message, IsError = isError });
    }
}
