using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using MiYin.Desktop.Models;
using Microsoft.UI.Dispatching;
using Windows.Devices.Enumeration;
using Windows.Media;
using Windows.Media.Core;
using Windows.Media.Devices;
using Windows.Media.Playback;
using Windows.Storage;
using Windows.Storage.Streams;

namespace MiYin.Desktop.Services;

public sealed class MediaService : INotifyPropertyChanged, IDisposable
{
    public static MediaService Instance { get; } = new();

    private static readonly Regex LyricTag = new(@"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]", RegexOptions.Compiled);

    private readonly MediaPlayer _player = new();
    private readonly DispatcherQueue _dispatcher;
    private readonly DispatcherQueueTimer _timer;
    private int _loadToken;
    private TimeSpan? _pendingSeek;
    private DateTime _lastVolumeSave = DateTime.MinValue;

    public ObservableCollection<Song> Queue { get; } = new();
    public ObservableCollection<LyricLine> Lyrics { get; } = new();

    public event PropertyChangedEventHandler? PropertyChanged;
    public event EventHandler? CurrentChanged;
    public event EventHandler<string>? PlaybackFailed;

    private Song? _current;
    private bool _isPlaying;
    private bool _isLoading;
    private TimeSpan _position;
    private TimeSpan _duration;
    private double _volume;
    private double _lastAudibleVolume = .75;
    private bool _muted;
    private string _repeatMode;
    private bool _shuffle;
    private readonly List<string> _shuffleHistory = [];
    private string _currentQuality = "";
    private string _requestedQuality = "auto";
    private string _error = "";
    private int _activeLyricIndex = -1;
    private bool _serverCached;
    private bool _silentMode;
    private bool _silentPlaying;
    private DateTime _silentStartedAt;
    private TimeSpan _silentBase;
    private DateTime _lastCheckpoint;
    private bool _restored;
    private bool _autoPlayIntent;
    private sealed class PrefetchedUrl { public string Key { get; init; } = ""; public DateTime At { get; init; } = DateTime.UtcNow; public UrlResult? Result { get; set; } }
    private PrefetchedUrl? _prefetchedUrl;
    private async Task PrefetchNextAsync()
    {
        if (!_isPlaying || _silentMode || _shuffle || _repeatMode == "one" || StopAfterTrack || (_duration - _position).TotalSeconds is <= 0 or > 25) return;
        if (SleepUntil is { } until && until < DateTime.UtcNow.AddSeconds(25)) return;
        var next = QueueIndex + 1;
        if (next >= Queue.Count) { if (_repeatMode == "off") return; next = 0; }
        if (next == QueueIndex || next < 0 || next >= Queue.Count) return;
        var song = Queue[next];
        if (song.Platform == "local" || DownloadService.Instance.TryGetDownloadPath(song.Key, out _)) return;
        var qualities = BuildQualityOrder(null);
        var key = song.Key + ":" + string.Join(",", qualities);
        if (_prefetchedUrl?.Key == key) return;
        var pending = new PrefetchedUrl { Key = key };
        _prefetchedUrl = pending;
        try { var result = await ApiService.ResolveUrlAsync(song, qualities); if (_prefetchedUrl == pending) pending.Result = result; }
        catch { /* Speculative failure never interrupts the current song. */ }
    }
    public DateTime? SleepUntil { get; private set; }
    public bool StopAfterTrack { get; private set; }
    public void SetSleep(int minutes) { StopAfterTrack = minutes == -1; SleepUntil = minutes > 0 ? DateTime.UtcNow.AddMinutes(minutes) : null; }
    public sealed class PlaybackSnapshot
    {
        public List<Song> Queue { get; set; } = new();
        public int Index { get; set; }
        public double Position { get; set; }
    }
    private static string SnapshotFile => Path.Combine(AppInfo.DataDirectory, "playback.json");
    private void SavePlayback()
    {
        try
        {
            File.WriteAllText(SnapshotFile + ".tmp", System.Text.Json.JsonSerializer.Serialize(new PlaybackSnapshot { Queue = Queue.ToList(), Index = QueueIndex, Position = _position.TotalSeconds }));
            File.Move(SnapshotFile + ".tmp", SnapshotFile, true);
        }
        catch { }
    }

    private MediaService()
    {
        _dispatcher = DispatcherQueue.GetForCurrentThread()
            ?? throw new InvalidOperationException("MediaService 必须在 UI 线程初始化");

        _volume = Math.Clamp(ConfigService.Current.Volume, 0, 1);
        if (_volume > .001) _lastAudibleVolume = _volume;
        _repeatMode = ConfigService.Current.Repeat is "one" or "off" or "all" ? ConfigService.Current.Repeat : "all";
        _shuffle = ConfigService.Current.Shuffle;
        if (_shuffle) _repeatMode = "all";

        _player.AudioCategory = MediaPlayerAudioCategory.Media;
        _player.Volume = _volume;
        _player.AutoPlay = false;
        _player.MediaOpened += Player_MediaOpened;
        _player.MediaFailed += Player_MediaFailed;
        _player.MediaEnded += Player_MediaEnded;
        _player.PlaybackSession.PlaybackStateChanged += Session_PlaybackStateChanged;

        var smtc = _player.SystemMediaTransportControls;
        smtc.IsEnabled = true;
        smtc.IsNextEnabled = true;
        smtc.IsPreviousEnabled = true;
        smtc.ButtonPressed += Smtc_ButtonPressed;
        try
        {
            var commandManager = _player.CommandManager;
            commandManager.IsEnabled = true;
            commandManager.NextBehavior.EnablingRule = MediaCommandEnablingRule.Always;
            commandManager.PreviousBehavior.EnablingRule = MediaCommandEnablingRule.Always;
            commandManager.NextReceived += (_, _) => Next();
            commandManager.PreviousReceived += (_, _) => Previous();
        }
        catch
        {
            /* 某些系统版本不支持 CommandManager */
        }

        _timer = _dispatcher.CreateTimer();
        _timer.Interval = TimeSpan.FromMilliseconds(250);
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
        try
        {
            var saved = System.Text.Json.JsonSerializer.Deserialize<PlaybackSnapshot>(File.ReadAllText(SnapshotFile));
            if (saved is not null && saved.Index >= 0 && saved.Index < saved.Queue.Count)
            {
                foreach (var song in saved.Queue) Queue.Add(song);
                QueueIndex = saved.Index; _current = Queue[QueueIndex];
                _position = TimeSpan.FromSeconds(Math.Max(0, saved.Position));
                _duration = TimeSpan.FromSeconds(_current.Interval); _restored = true;
            }
        }
        catch { }
    }

    // ---------- 展示属性 ----------
    public Song? Current => _current;
    public bool HasCurrent => _current is not null;
    public string Title => _current?.Name ?? "还没有播放歌曲";
    public string Singer => _current?.SingerText ?? "选一首歌，开始聆听";
    public string AlbumName => _current?.AlbumName ?? "";
    public string CoverUrl => _current?.CoverUrl ?? "";
    public bool IsPlaying => _isPlaying;
    public bool IsLoading => _isLoading;
    public bool IsMuted => _muted;
    public bool Shuffle => _shuffle;
    public string RepeatMode => _repeatMode;
    public string CurrentQuality => _currentQuality;
    public string RequestedQuality => _requestedQuality;
    public string QualityLabel => string.IsNullOrWhiteSpace(_currentQuality) ? (_isLoading ? "加载中" : "音质") : _currentQuality;
    public string QualityDescription => $"期望：{PlaybackQuality.Name(BuildQualityOrder(_requestedQuality)[0])}\n实际：{PlaybackQuality.Name(_currentQuality)}"
        + (PlaybackQuality.IsKnown(_currentQuality) && _currentQuality != BuildQualityOrder(_requestedQuality)[0] ? "\n当前音源返回其他音质" : "");
    public bool RepeatActive => _shuffle || _repeatMode != "off";
    public string ErrorMessage => _error;
    public bool ServerCached => _serverCached;
    public bool SilentMode => _silentMode;
    public string PlaybackModeText => _silentMode ? "静音播放" : "";
    public double Volume
    {
        get => _volume;
        set => SetVolume(value);
    }

    public TimeSpan Position => _position;
    public TimeSpan Duration => _duration;
    public double PositionSeconds => _position.TotalSeconds;
    public double DurationSeconds => Math.Max(1, _duration.TotalSeconds);
    public string PositionText => FormatText.Time(_position);
    public string DurationText => _duration > TimeSpan.Zero ? FormatText.Time(_duration) : "--:--";
    public string PlayGlyph => _isPlaying ? "\uE769" : "\uE768";
    public string RepeatGlyph => PlaybackOrder.Mode(_repeatMode, _shuffle) switch
    {
        "shuffle" => "\uE8B1",
        "one" => "\uE8ED",
        "off" => "\uE8FD",
        _ => "\uE8EE",
    };
    public string VolumeGlyph => _muted || _volume <= 0.001 ? "\uE74F" : "\uE767";
    public string RepeatText => PlaybackOrder.Mode(_repeatMode, _shuffle) switch
    {
        "shuffle" => "随机播放",
        "one" => "单曲循环",
        "off" => "顺序播放",
        _ => "列表循环",
    };
    public int ActiveLyricIndex => _activeLyricIndex;
    public string ActiveLyric => _activeLyricIndex >= 0 && _activeLyricIndex < Lyrics.Count
        ? Lyrics[_activeLyricIndex].Text
        : "";
    public bool HasLyrics => Lyrics.Count > 0;
    public int QueueIndex { get; private set; } = -1;

    // ---------- 播放控制 ----------
    public void PlaySongs(IEnumerable<Song> songs, int startIndex = 0)
    {
        var list = songs.ToList();
        if (list.Count == 0) return;
        _shuffleHistory.Clear();
        Queue.Clear();
        foreach (var song in list) Queue.Add(song);
        PlayAt(Math.Clamp(startIndex, 0, list.Count - 1));
        OnPropertyChanged(nameof(Queue));
    }

    public void PlaySong(Song song, IReadOnlyList<Song>? list = null)
    {
        _shuffleHistory.Clear();
        if (list is { Count: > 0 })
        {
            Queue.Clear();
            foreach (var item in list) Queue.Add(item);
            var index = list.ToList().FindIndex(item => item.Key == song.Key);
            PlayAt(index >= 0 ? index : 0);
        }
        else
        {
            Queue.Clear();
            Queue.Add(song);
            PlayAt(0);
        }
    }

    public void PlayAt(int index)
    {
        if (index < 0 || index >= Queue.Count) return;
        _restored = false;
        QueueIndex = index;
        OnPropertyChanged(nameof(QueueIndex));
        var song = Queue[index];
        _ = LoadAsync(song);
    }

    public async Task PlayPauseAsync()
    {
        if (_current is null) return;
        if (_isLoading && _autoPlayIntent) { _loadToken++; _isLoading = false; Pause(); OnPropertyChanged(nameof(IsLoading)); return; }
        if (_silentMode)
        {
            SetSilentPlaying(!_silentPlaying);
            return;
        }
        if (_player.Source is null)
        {
            var start = _position;
            _restored = false;
            await LoadAsync(_current, startAt: start);
            return;
        }
        if (_isPlaying) Pause();
        else { _autoPlayIntent = true; _player.Play(); }
    }

    public void Pause()
    {
        _autoPlayIntent = false;
        if (_silentMode)
        {
            SetSilentPlaying(false);
            return;
        }
        _player.Pause();
    }

    public void Play()
    {
        if (_current is null) return;
        if (_player.Source is null && !_silentMode) { _restored = false; _ = LoadAsync(_current, startAt: _position); return; }
        _autoPlayIntent = true;
        if (_silentMode)
        {
            SetSilentPlaying(true);
            return;
        }
        _player.Play();
    }

    public void Next(bool manual = true)
    {
        if (Queue.Count == 0) return;
        var next = PlaybackOrder.NextIndex(QueueIndex, Queue.Count, PlaybackOrder.Mode(_repeatMode, _shuffle), manual);
        if (next < 0)
        {
            Pause();
            return;
        }
        if (_shuffle && _current is not null)
        {
            _shuffleHistory.Add(_current.Key);
            if (_shuffleHistory.Count > 100) _shuffleHistory.RemoveAt(0);
        }
        PlayAt(next);
    }

    public void Previous()
    {
        if (Queue.Count == 0) return;
        if (_position.TotalSeconds > 3)
        {
            Seek(TimeSpan.Zero);
            return;
        }
        if (_shuffle)
        {
            while (_shuffleHistory.Count > 0)
            {
                var key = _shuffleHistory[^1];
                _shuffleHistory.RemoveAt(_shuffleHistory.Count - 1);
                var previous = Queue.ToList().FindIndex(song => song.Key == key);
                if (previous >= 0) { PlayAt(previous); return; }
            }
            PlayAt(PlaybackOrder.NextIndex(QueueIndex, Queue.Count, "shuffle", true));
            return;
        }
        var prev = QueueIndex - 1;
        if (prev < 0) prev = _repeatMode == "off" ? 0 : Queue.Count - 1;
        PlayAt(prev);
    }

    public void Seek(TimeSpan position)
    {
        if (_restored) { _position = ClampPosition(position); SavePlayback(); OnPropertyChanged(nameof(PositionSeconds)); return; }
        if (_duration > TimeSpan.Zero)
        {
            position = position < TimeSpan.Zero ? TimeSpan.Zero : position > _duration ? _duration : position;
        }
        if (_silentMode)
        {
            _position = position;
            _silentBase = position;
            _silentStartedAt = DateTime.UtcNow;
            OnPropertyChanged(nameof(Position));
            OnPropertyChanged(nameof(PositionSeconds));
            OnPropertyChanged(nameof(PositionText));
            UpdateActiveLyric();
            return;
        }
        _player.PlaybackSession.Position = position;
        _position = position;
        OnPropertyChanged(nameof(Position));
        OnPropertyChanged(nameof(PositionSeconds));
        OnPropertyChanged(nameof(PositionText));
        UpdateActiveLyric();
    }

    public void SetVolume(double value)
    {
        value = Math.Clamp(value, 0, 1);
        _volume = value;
        if (value > .001) _lastAudibleVolume = value;
        _player.Volume = value;
        _muted = value <= 0.001;
        _player.IsMuted = false;
        OnPropertyChanged(nameof(Volume));
        OnPropertyChanged(nameof(VolumeGlyph));
        OnPropertyChanged(nameof(IsMuted));
        ConfigService.Current.Volume = value;
        if ((DateTime.UtcNow - _lastVolumeSave).TotalSeconds > 1)
        {
            _lastVolumeSave = DateTime.UtcNow;
            ConfigService.Save();
        }
    }

    public void ToggleMute()
    {
        if (_volume <= .001) { SetVolume(_lastAudibleVolume); return; }
        _muted = !_muted;
        _player.IsMuted = _muted;
        OnPropertyChanged(nameof(IsMuted));
        OnPropertyChanged(nameof(VolumeGlyph));
    }

    public void CycleRepeat()
    {
        SetPlaybackMode(PlaybackOrder.NextMode(PlaybackOrder.Mode(_repeatMode, _shuffle)));
    }

    public void SetPlaybackMode(string mode)
    {
        if (mode is not ("off" or "all" or "one" or "shuffle")) return;
        _shuffle = mode == "shuffle";
        _repeatMode = _shuffle ? "all" : mode;
        _shuffleHistory.Clear();
        ConfigService.Current.Repeat = _repeatMode;
        ConfigService.Current.Shuffle = _shuffle;
        ConfigService.Save();
        OnPropertyChanged(nameof(RepeatMode));
        OnPropertyChanged(nameof(RepeatText));
        OnPropertyChanged(nameof(RepeatGlyph));
        OnPropertyChanged(nameof(RepeatActive));
        OnPropertyChanged(nameof(Shuffle));
    }

    public void ToggleShuffle()
    {
        _shuffle = !_shuffle;
        _repeatMode = "all";
        _shuffleHistory.Clear();
        ConfigService.Current.Shuffle = _shuffle;
        ConfigService.Current.Repeat = _repeatMode;
        ConfigService.Save();
        OnPropertyChanged(nameof(Shuffle));
        OnPropertyChanged(nameof(RepeatMode));
        OnPropertyChanged(nameof(RepeatText));
        OnPropertyChanged(nameof(RepeatGlyph));
        OnPropertyChanged(nameof(RepeatActive));
    }

    public async Task SetQualityAsync(string quality)
    {
        if (_current is null) return;
        _requestedQuality = quality;
        var position = _position;
        await LoadAsync(_current, quality == "auto" ? null : quality, _isPlaying || (_isLoading && _autoPlayIntent), position, recordPlay: false, refreshSource: true);
    }

    public void AddToQueue(Song song, bool playNext = false)
    {
        if (Queue.Any(item => item.Key == song.Key)) { Notify.Show("此歌曲已在队列中"); return; }
        if (playNext && QueueIndex >= 0)
            Queue.Insert(QueueIndex + 1, song);
        else
            Queue.Add(song);
        Notify.Show(playNext ? "已设为下一首播放" : "已添加到播放队列");
    }

    public void RemoveFromQueue(int index)
    {
        if (index < 0 || index >= Queue.Count) return;
        var removingCurrent = index == QueueIndex;
        var resume = _isPlaying || (_isLoading && _autoPlayIntent);
        Queue.RemoveAt(index);
        if (index < QueueIndex) QueueIndex--;
        if (removingCurrent)
        {
            _loadToken++; _restored = false;
            if (Queue.Count == 0)
            {
                ClearQueue();
                return;
            }
            QueueIndex = Math.Clamp(QueueIndex, 0, Queue.Count - 1);
            _ = LoadAsync(Queue[QueueIndex], autoPlay: resume);
        }
        OnPropertyChanged(nameof(QueueIndex));
        SavePlayback();
    }

    public void ClearQueue()
    {
        _loadToken++; _restored = false; _autoPlayIntent = false; _isLoading = false;
        _position = TimeSpan.Zero; _duration = TimeSpan.Zero; Lyrics.Clear(); _prefetchedUrl = null;
        StopSilentPlayback();
        _isPlaying = false;
        Queue.Clear();
        QueueIndex = -1;
        _player.Pause();
        _player.Source = null;
        _current = null;
        NotifyCurrent();
        OnPropertyChanged(nameof(IsPlaying));
        OnPropertyChanged(nameof(PlayGlyph));
        OnPropertyChanged(nameof(IsLoading)); OnPropertyChanged(nameof(PositionSeconds)); OnPropertyChanged(nameof(DurationSeconds));
        SavePlayback();
    }

    // ---------- 加载 ----------
    private async Task LoadAsync(
        Song song,
        string? forceQuality = null,
        bool autoPlay = true,
        TimeSpan? startAt = null,
        bool recordPlay = true,
        bool refreshSource = false)
    {
        var version = ++_loadToken;
        _restored = false;
        _player.Pause();
        _player.Source = null;
        _pendingSeek = null;
        _autoPlayIntent = autoPlay;
        StopSilentPlayback();
        if (_current?.Key != song.Key) _requestedQuality = "auto";
        _current = song;
        var preferred = BuildQualityOrder(forceQuality ?? _requestedQuality);
        var requireMatch = refreshSource || _requestedQuality != "auto";
        AppLog.Write($"load start key={song.Key} name={song.Name}");
        _isLoading = true;
        _isPlaying = false;
        _error = "";
        _serverCached = false;
        _currentQuality = "";
        _duration = song.Interval > 0 ? TimeSpan.FromSeconds(song.Interval) : TimeSpan.Zero;
        _position = startAt ?? TimeSpan.Zero;
        Lyrics.Clear();
        _activeLyricIndex = -1;
        OnPropertyChanged(nameof(HasLyrics));
        OnPropertyChanged(nameof(ActiveLyricIndex));
        OnPropertyChanged(nameof(ActiveLyric));
        NotifyCurrent();
        OnPropertyChanged(nameof(IsPlaying));
        OnPropertyChanged(nameof(ErrorMessage));
        OnPropertyChanged(nameof(SilentMode));
        OnPropertyChanged(nameof(PlaybackModeText));
        if (recordPlay && song.Platform != "local") LibraryService.Instance.RecordPlay(song);

        if (song.Platform != "local") _ = LoadLyricsAsync(song, version);

        var noOutput = await HasNoAudioOutputAsync();
        if (version != _loadToken) return;
        if (noOutput)
        {
            _player.Pause();
            _player.Source = null;
            _isLoading = false;
            AppLog.Write("no audio output endpoint; starting silent playback clock");
            StartSilentPlayback();
            UpdateSmtc(song);
            return;
        }

        try
        {
            MediaSource? source = null;
            var quality = "";
            string? cacheSource = null;

            if (LocalMusicService.Instance.TryGetPath(song.Key, out var localPath))
            {
                var file = await StorageFile.GetFileFromPathAsync(localPath);
                source = MediaSource.CreateFromStorageFile(file);
                quality = "本地文件";
            }
            else if (song.Platform == "local") throw new FileNotFoundException("本地文件已移动或删除，请重新扫描目录");
            else if (DownloadService.Instance.TryGetDownloadPath(song.Key, out var downloadedPath, out var downloadedQuality)
                && PlaybackQuality.CanReuse(downloadedQuality, preferred, requireMatch))
            {
                try
                {
                    var file = await StorageFile.GetFileFromPathAsync(downloadedPath);
                    source = MediaSource.CreateFromStorageFile(file);
                    quality = string.IsNullOrWhiteSpace(downloadedQuality) ? "本地下载" : downloadedQuality;
                    AppLog.Write("source=download path=" + downloadedPath);
                }
                catch
                {
                    source = null;
                }
            }
            else if (CacheService.Instance.TryGetLocalPath(song.Key, out var cachedPath, out var cachedQuality)
                && PlaybackQuality.CanReuse(cachedQuality, preferred, requireMatch))
            {
                try
                {
                    var file = await StorageFile.GetFileFromPathAsync(cachedPath);
                    source = MediaSource.CreateFromStorageFile(file);
                    quality = cachedQuality;
                    AppLog.Write("source=cache path=" + cachedPath);
                }
                catch
                {
                    source = null;
                }
            }

            if (source is null)
            {
                var cached = _prefetchedUrl;
                var key = song.Key + ":" + string.Join(",", preferred);
                var resolved = cached?.Key == key && cached.Result is not null && (DateTime.UtcNow - cached.At).TotalSeconds < 45
                    ? cached.Result : await ApiService.ResolveUrlAsync(song, preferred);
                _prefetchedUrl = null;
                if (version != _loadToken) return;
                AppLog.Write($"resolved quality={resolved.Quality} cached={resolved.Cached} url={SafeUrl(resolved.PlayUrl)}");
                cacheSource = LocalMediaServer.Instance.Register(ApiService.AbsoluteUrl(resolved.PlayUrl));
                AppLog.Write("proxy url=" + cacheSource);
                source = MediaSource.CreateFromUri(new Uri(cacheSource));
                quality = resolved.Quality;
                _serverCached = resolved.Cached;
                if (ConfigService.Current.AutoCache && !string.IsNullOrWhiteSpace(cacheSource))
                {
                    _ = CacheService.Instance.EnsureAsync(song, cacheSource, resolved.Quality);
                }
            }

            if (version != _loadToken) return;
            _currentQuality = quality;
            _pendingSeek = startAt;
            _player.Source = source;
            AppLog.Write("player source assigned, autoplay=" + autoPlay);
            if (_autoPlayIntent) _player.Play();
            else _player.Pause();
            UpdateSmtc(song);
            OnPropertyChanged(nameof(CurrentQuality));
            OnPropertyChanged(nameof(QualityLabel));
            OnPropertyChanged(nameof(QualityDescription));
            OnPropertyChanged(nameof(RequestedQuality));
            OnPropertyChanged(nameof(ServerCached));
            if (refreshSource && song.Platform != "local")
            {
                Notify.Show(quality == preferred[0] ? "已切换为" + PlaybackQuality.Name(quality)
                    : $"{PlaybackQuality.Name(preferred[0])} 暂不可用，当前播放{PlaybackQuality.Name(quality)}");
            }
        }
        catch (Exception ex)
        {
            if (version != _loadToken) return;
            AppLog.Write("load error: " + ex);
            _isLoading = false;
            _error = ex.Message;
            Notify.Show("播放失败：" + ex.Message, true);
            PlaybackFailed?.Invoke(this, ex.Message);
            OnPropertyChanged(nameof(ErrorMessage));
            OnPropertyChanged(nameof(IsLoading));
            OnPropertyChanged(nameof(QualityLabel));
        }
    }

    private static string SafeUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.GetLeftPart(UriPartial.Path) : url;

    private List<string> BuildQualityOrder(string? forceQuality)
    {
        return PlaybackQuality.Order(ConfigService.Current.Quality, forceQuality);
    }

    private void Player_MediaOpened(MediaPlayer sender, object args)
    {
        _dispatcher.TryEnqueue(() =>
        {
            _duration = sender.PlaybackSession.NaturalDuration;
            AppLog.Write("media opened duration=" + _duration);
            if (_pendingSeek is { } seek && seek > TimeSpan.Zero)
            {
                sender.PlaybackSession.Position = seek;
                _pendingSeek = null;
            }
            _isLoading = false;
            OnPropertyChanged(nameof(IsLoading));
            OnPropertyChanged(nameof(Duration));
            OnPropertyChanged(nameof(DurationSeconds));
            OnPropertyChanged(nameof(DurationText));
        });
    }

    private void Player_MediaFailed(MediaPlayer sender, MediaPlayerFailedEventArgs args)
    {
        var token = _loadToken;
        _ = HandleMediaFailureAsync(args, token);
    }

    private async Task HandleMediaFailureAsync(MediaPlayerFailedEventArgs args, int token)
    {
        var noAudio = await HasNoAudioOutputAsync();
        _dispatcher.TryEnqueue(() =>
        {
            if (token != _loadToken) return;
            AppLog.Write($"media failed: {args.Error} {args.ErrorMessage} extended={args.ExtendedErrorCode} noAudio={noAudio}");
            if (noAudio)
            {
                StartSilentPlayback();
                return;
            }

            _isLoading = false;
            _isPlaying = false;
            var message = args.Error == MediaPlayerError.SourceNotSupported
                ? "无法播放该音频：系统音频设备不可用或格式不受支持"
                : args.ErrorMessage;
            _error = message;
            Notify.Show("播放失败：" + message, true);
            PlaybackFailed?.Invoke(this, message);
            OnPropertyChanged(nameof(IsLoading));
            OnPropertyChanged(nameof(IsPlaying));
            OnPropertyChanged(nameof(PlayGlyph));
            OnPropertyChanged(nameof(ErrorMessage));
        });
    }

    private static async Task<bool> HasNoAudioOutputAsync()
    {
        try
        {
            var devices = await DeviceInformation.FindAllAsync(MediaDevice.GetAudioRenderSelector());
            return devices.Count == 0;
        }
        catch
        {
            return false;
        }
    }

    private void StartSilentPlayback()
    {
        if (_current is null) return;
        _silentMode = true;
        _silentPlaying = _autoPlayIntent;
        _silentBase = _position;
        _silentStartedAt = DateTime.UtcNow;
        _isPlaying = _autoPlayIntent;
        _isLoading = false;
        _error = "";
        if (_duration <= TimeSpan.Zero && _current.Interval > 0)
            _duration = TimeSpan.FromSeconds(_current.Interval);
        if (_duration <= TimeSpan.Zero)
            _duration = TimeSpan.FromMinutes(3);
        AppLog.Write("silent playback mode enabled duration=" + _duration);
        OnPropertyChanged(nameof(QualityLabel));
        OnPropertyChanged(nameof(IsPlaying));
        OnPropertyChanged(nameof(PlayGlyph));
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(ErrorMessage));
        OnPropertyChanged(nameof(SilentMode));
        OnPropertyChanged(nameof(PlaybackModeText));
        OnPropertyChanged(nameof(Duration));
        OnPropertyChanged(nameof(DurationSeconds));
        OnPropertyChanged(nameof(DurationText));
    }

    private void SetSilentPlaying(bool playing)
    {
        if (!_silentMode) return;
        if (playing)
        {
            if (_duration > TimeSpan.Zero && _position >= _duration) _position = TimeSpan.Zero;
            _silentBase = _position;
            _silentStartedAt = DateTime.UtcNow;
        }
        else
        {
            _position = ClampPosition(_silentBase + (DateTime.UtcNow - _silentStartedAt));
            _silentBase = _position;
        }
        _silentPlaying = playing;
        _isPlaying = playing;
        OnPropertyChanged(nameof(IsPlaying));
        OnPropertyChanged(nameof(PlayGlyph));
        OnPropertyChanged(nameof(Position));
        OnPropertyChanged(nameof(PositionSeconds));
        OnPropertyChanged(nameof(PositionText));
        UpdateActiveLyric();
    }

    private void StopSilentPlayback()
    {
        if (!_silentMode) return;
        _silentMode = false;
        _silentPlaying = false;
        OnPropertyChanged(nameof(SilentMode));
        OnPropertyChanged(nameof(PlaybackModeText));
    }

    private TimeSpan ClampPosition(TimeSpan position)
    {
        if (position < TimeSpan.Zero) return TimeSpan.Zero;
        return _duration > TimeSpan.Zero && position > _duration ? _duration : position;
    }

    private void Player_MediaEnded(MediaPlayer sender, object args)
    {
        _dispatcher.TryEnqueue(() =>
        {
            if (_silentMode) return;
            if (StopAfterTrack) { SetSleep(0); Pause(); SavePlayback(); return; }
            if (_repeatMode == "one")
            {
                sender.PlaybackSession.Position = TimeSpan.Zero;
                sender.Play();
                return;
            }
            Next(manual: false);
        });
    }

    private void Session_PlaybackStateChanged(MediaPlaybackSession sender, object args)
    {
        _dispatcher.TryEnqueue(() =>
        {
            AppLog.Write("playback state=" + sender.PlaybackState);
            if (_silentMode) return;
            var playing = sender.PlaybackState == MediaPlaybackState.Playing;
            if (playing == _isPlaying) return;
            _isPlaying = playing;
            OnPropertyChanged(nameof(IsPlaying));
            OnPropertyChanged(nameof(PlayGlyph));
        });
    }

    private void Tick()
    {
        _ = PrefetchNextAsync();
        if (SleepUntil is { } until && DateTime.UtcNow >= until) { SetSleep(0); _loadToken++; _isLoading = false; Pause(); }
        if ((DateTime.UtcNow - _lastCheckpoint).TotalSeconds >= 5) { _lastCheckpoint = DateTime.UtcNow; SavePlayback(); }
        if (_current is null) return;
        if (_restored) return;
        if (_silentMode)
        {
            if (_silentPlaying)
            {
                _position = _silentBase + (DateTime.UtcNow - _silentStartedAt);
                if (_duration > TimeSpan.Zero && _position >= _duration)
                {
                    _position = _duration;
                    _silentPlaying = false;
                    _isPlaying = false;
                    if (StopAfterTrack) { SetSleep(0); SavePlayback(); return; }
                    OnPropertyChanged(nameof(IsPlaying));
                    OnPropertyChanged(nameof(PlayGlyph));
                    if (_repeatMode == "one")
                    {
                        _position = TimeSpan.Zero;
                        _silentBase = TimeSpan.Zero;
                        _silentStartedAt = DateTime.UtcNow;
                        _silentPlaying = true;
                        _isPlaying = true;
                        OnPropertyChanged(nameof(IsPlaying));
                        OnPropertyChanged(nameof(PlayGlyph));
                    }
                    else
                    {
                        OnPropertyChanged(nameof(Position));
                        OnPropertyChanged(nameof(PositionSeconds));
                        OnPropertyChanged(nameof(PositionText));
                        Next(manual: false);
                        return;
                    }
                }
            }
            OnPropertyChanged(nameof(Position));
            OnPropertyChanged(nameof(PositionSeconds));
            OnPropertyChanged(nameof(PositionText));
            UpdateActiveLyric();
            return;
        }

        if (_player.Source is null || _isLoading || _pendingSeek is not null) return;
        var session = _player.PlaybackSession;
        _position = session.Position;
        if (session.NaturalDuration > TimeSpan.Zero) _duration = session.NaturalDuration;
        OnPropertyChanged(nameof(Position));
        OnPropertyChanged(nameof(PositionSeconds));
        OnPropertyChanged(nameof(PositionText));
        UpdateActiveLyric();
    }

    private void UpdateActiveLyric()
    {
        if (Lyrics.Count == 0) return;
        var seconds = _position.TotalSeconds + ConfigService.Current.LyricOffset;
        var low = 0;
        var high = Lyrics.Count - 1;
        var index = -1;
        while (low <= high)
        {
            var mid = (low + high) / 2;
            if (Lyrics[mid].Time.TotalSeconds <= seconds)
            {
                index = mid;
                low = mid + 1;
            }
            else
            {
                high = mid - 1;
            }
        }
        if (index == _activeLyricIndex) return;
        _activeLyricIndex = index;
        OnPropertyChanged(nameof(ActiveLyricIndex));
        OnPropertyChanged(nameof(ActiveLyric));
    }

    private async Task LoadLyricsAsync(Song song, int version)
    {
        try
        {
            var result = await ApiService.GetLyricAsync(song);
            if (version != _loadToken) return;
            var lines = ParseLyrics(result.Lyric.Lyric, result.Lyric.TLyric);
            _dispatcher.TryEnqueue(() =>
            {
                if (version != _loadToken) return;
                Lyrics.Clear();
                foreach (var line in lines) Lyrics.Add(line);
                _activeLyricIndex = -1;
                OnPropertyChanged(nameof(HasLyrics));
                OnPropertyChanged(nameof(ActiveLyricIndex));
                OnPropertyChanged(nameof(ActiveLyric));
            });
        }
        catch
        {
            _dispatcher.TryEnqueue(() =>
            {
                if (version != _loadToken) return;
                Lyrics.Clear();
                _activeLyricIndex = -1;
                OnPropertyChanged(nameof(HasLyrics));
                OnPropertyChanged(nameof(ActiveLyricIndex));
                OnPropertyChanged(nameof(ActiveLyric));
            });
        }
    }

    private static List<LyricLine> ParseLyrics(string lrc, string? translation)
    {
        var translations = new Dictionary<long, string>();
        if (!string.IsNullOrWhiteSpace(translation))
        {
            foreach (var line in ParseRaw(translation))
                translations[line.Time] = line.Text;
        }

        var result = new List<LyricLine>();
        foreach (var line in ParseRaw(lrc))
        {
            translations.TryGetValue(line.Time, out var text);
            result.Add(new LyricLine
            {
                Time = TimeSpan.FromMilliseconds(line.Time),
                Text = line.Text,
                Translation = text ?? "",
            });
        }
        result.Sort((a, b) => a.Time.CompareTo(b.Time));
        return result;
    }

    private static List<(long Time, string Text)> ParseRaw(string lrc)
    {
        var list = new List<(long, string)>();
        if (string.IsNullOrWhiteSpace(lrc)) return list;
        foreach (var raw in lrc.Replace("\r\n", "\n").Split('\n'))
        {
            var matches = LyricTag.Matches(raw);
            if (matches.Count == 0) continue;
            var text = raw[(matches[^1].Index + matches[^1].Length)..].Trim();
            if (text.Length == 0) continue;
            foreach (Match match in matches)
            {
                var minutes = int.Parse(match.Groups[1].Value);
                var seconds = int.Parse(match.Groups[2].Value);
                var fraction = match.Groups[3].Value;
                var ms = fraction.Length switch
                {
                    1 => int.Parse(fraction) * 100,
                    2 => int.Parse(fraction) * 10,
                    3 => int.Parse(fraction),
                    _ => 0,
                };
                list.Add(((minutes * 60L + seconds) * 1000 + ms, text));
            }
        }
        return list;
    }

    private void UpdateSmtc(Song song)
    {
        try
        {
            var smtc = _player.SystemMediaTransportControls;
            smtc.IsEnabled = true;
            smtc.IsNextEnabled = Queue.Count > 1;
            smtc.IsPreviousEnabled = Queue.Count > 1;
            var updater = smtc.DisplayUpdater;
            updater.Type = MediaPlaybackType.Music;
            updater.MusicProperties.Title = song.Name;
            updater.MusicProperties.Artist = song.Singer;
            updater.MusicProperties.AlbumTitle = song.AlbumName;
            if (!string.IsNullOrWhiteSpace(song.CoverUrl))
            {
                updater.Thumbnail = RandomAccessStreamReference.CreateFromUri(new Uri(song.CoverUrl));
            }
            updater.Update();
        }
        catch
        {
            /* 忽略 SMTC 失败 */
        }
    }

    private void Smtc_ButtonPressed(SystemMediaTransportControls sender, SystemMediaTransportControlsButtonPressedEventArgs args)
    {
        _dispatcher.TryEnqueue(() =>
        {
            switch (args.Button)
            {
                case SystemMediaTransportControlsButton.Play:
                    Play();
                    break;
                case SystemMediaTransportControlsButton.Pause:
                    Pause();
                    break;
                case SystemMediaTransportControlsButton.Next:
                    Next();
                    break;
                case SystemMediaTransportControlsButton.Previous:
                    Previous();
                    break;
            }
        });
    }

    private void NotifyCurrent()
    {
        OnPropertyChanged(nameof(Current));
        OnPropertyChanged(nameof(HasCurrent));
        OnPropertyChanged(nameof(Title));
        OnPropertyChanged(nameof(Singer));
        OnPropertyChanged(nameof(AlbumName));
        OnPropertyChanged(nameof(CoverUrl));
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(PlayGlyph));
        OnPropertyChanged(nameof(PositionText));
        OnPropertyChanged(nameof(CurrentQuality));
        OnPropertyChanged(nameof(QualityLabel));
        OnPropertyChanged(nameof(QualityDescription));
        OnPropertyChanged(nameof(RequestedQuality));
        OnPropertyChanged(nameof(DurationText));
        OnPropertyChanged(nameof(DurationSeconds));
        CurrentChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Dispose()
    {
        SavePlayback();
        _timer.Stop();
        _player.Dispose();
    }

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
