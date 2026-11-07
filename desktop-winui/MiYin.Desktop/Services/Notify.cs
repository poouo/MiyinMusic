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
        Shown?.Invoke(null, new NotifyEventArgs { Message = message, IsError = isError });
    }
}
