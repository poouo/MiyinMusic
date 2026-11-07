using System.ComponentModel;
using System.Runtime.CompilerServices;
using MiYin.Desktop.Models;

namespace MiYin.Desktop.Services;

public sealed class AuthService : INotifyPropertyChanged
{
    public static AuthService Instance { get; } = new();

    private User? _user;

    public User? User => _user;
    public bool IsLoggedIn => _user is not null;
    public bool IsAdmin => _user?.Role == "admin";
    public ServerAppConfig? ServerConfig { get; private set; }

    public event EventHandler? Changed;
    public event PropertyChangedEventHandler? PropertyChanged;

    public async Task InitializeAsync()
    {
        if (!string.IsNullOrEmpty(ConfigService.Current.Token))
        {
            try
            {
                var me = await ApiService.MeAsync();
                SetUser(me.User);
            }
            catch (ApiException ex) when (ex.Status == 401)
            {
                ConfigService.ClearAuth();
                SetUser(null);
            }
            catch
            {
                SetUser(ConfigService.Current.User);
            }
        }
        else
        {
            SetUser(ConfigService.Current.User);
        }
        await RefreshServerConfigAsync();
    }

    public async Task RefreshServerConfigAsync()
    {
        try
        {
            ServerConfig = await ApiService.GetServerConfigAsync();
        }
        catch
        {
            ServerConfig ??= new ServerAppConfig { AllowRegister = true, Download = new DownloadPolicy { Enabled = true } };
        }
    }

    public bool CanDownload
    {
        get
        {
            var policy = ServerConfig?.Download;
            if (policy is null || !policy.Enabled) return false;
            var audience = _user?.Role switch
            {
                "admin" => "admin",
                "vip" => "vip",
                null => "guest",
                _ => "user",
            };
            return policy.Roles.Contains(audience);
        }
    }

    public async Task<User> LoginAsync(string username, string password)
    {
        var user = await ApiService.LoginAsync(username, password);
        SetUser(user);
        await LibraryService.Instance.ReloadAsync();
        await RefreshServerConfigAsync();
        RaiseChanged();
        return user;
    }

    public async Task<User> RegisterAsync(string username, string password, string? nickname)
    {
        var user = await ApiService.RegisterAsync(username, password, nickname);
        SetUser(user);
        await LibraryService.Instance.ReloadAsync();
        await RefreshServerConfigAsync();
        RaiseChanged();
        return user;
    }

    public async Task LogoutAsync()
    {
        await ApiService.LogoutAsync();
        SetUser(null);
        await LibraryService.Instance.ReloadAsync();
        RaiseChanged();
    }

    public async Task UpdateNicknameAsync(string nickname)
    {
        var user = await ApiService.UpdateProfileAsync(nickname);
        SetUser(user);
        RaiseChanged();
    }

    private void SetUser(User? user)
    {
        _user = user;
        ConfigService.SetUser(user);
        OnPropertyChanged(nameof(User));
        OnPropertyChanged(nameof(IsLoggedIn));
        OnPropertyChanged(nameof(IsAdmin));
        OnPropertyChanged(nameof(CanDownload));
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
