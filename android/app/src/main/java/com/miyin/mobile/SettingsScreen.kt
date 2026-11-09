package com.miyin.mobile

import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import android.content.Intent
import android.provider.Settings
import androidx.core.net.toUri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.imageLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@OptIn(coil.annotation.ExperimentalCoilApi::class)
@Composable
fun SettingsScreen(user: User?, themeMode: String, onTheme: (String) -> Unit, onQuality: (String) -> Unit,
    onLogin: () -> Unit, onLogout: () -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { AppPrefs(context) }
    val scope = rememberCoroutineScope()
    var cacheLimit by remember { mutableStateOf(prefs.audioCacheMb) }
    var cachedHome by remember { mutableStateOf(prefs.showCachedHome) }
    var quality by remember { mutableStateOf(prefs.preferredQuality) }
    var desktopLyrics by remember { mutableStateOf(prefs.desktopLyrics && Settings.canDrawOverlays(context)) }
    var lyricStyle by remember { mutableStateOf(prefs.lyricStyle) }
    var lyricSize by remember { mutableStateOf(prefs.lyricSize) }
    var lyricDouble by remember { mutableStateOf(prefs.lyricDoubleLine) }
    var lyricLocked by remember { mutableStateOf(prefs.lyricLocked) }
    val overlayPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        desktopLyrics = prefs.desktopLyrics && Settings.canDrawOverlays(context)
        prefs.desktopLyrics = desktopLyrics
        DesktopLyrics.configure(context)
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                desktopLyrics = prefs.desktopLyrics && Settings.canDrawOverlays(context)
                lyricLocked = prefs.lyricLocked
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    var carLyrics by remember { mutableStateOf(prefs.carLyrics) }
    var eqEnabled by remember { mutableStateOf(prefs.eqEnabled) }
    var eqPreset by remember { mutableStateOf(prefs.eqPreset) }
    var gains by remember { mutableStateOf(EqualizerEngine.gains(prefs)) }
    var cacheUsage by remember { mutableStateOf("正在统计…") }
    var clearing by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    suspend fun usage(): String = withContext(Dispatchers.IO) {
        val audio = PlaybackCache.get(context).cacheSpace / 1024.0 / 1024.0
        val artwork = (context.imageLoader.diskCache?.size ?: 0) / 1024.0 / 1024.0
        "音频 %.1f MB · 封面 %.1f MB".format(audio, artwork)
    }
    LaunchedEffect(Unit) { cacheUsage = usage() }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
        .statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBack, "返回") }
            Text("设置", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                SettingsCard("外观") {
                    ChoiceRow(listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"), themeMode, onTheme)
                    SettingSwitch("启动时显示首页缓存", "先显示上次内容，再自动更新最新内容", cachedHome) {
                        cachedHome = it; prefs.showCachedHome = it
                    }
                }
            }
            item {
                SettingsCard("播放与车载") {
                    Text("优先音质", style = MaterialTheme.typography.titleSmall)
                    ChoiceRow(audioQualities, quality) {
                        quality = it; onQuality(it)
                    }
                    Text("切换后从下一首开始使用，音源不可用时自动回退。", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    SettingSwitch("车载蓝牙歌词", "通过媒体标题和歌词广播同步；需车机支持。兼容模式也会更新通知和锁屏标题。", carLyrics) {
                        carLyrics = it; prefs.carLyrics = it; CarLyrics.configure(context)
                    }
                }
            }
            item {
                SettingsCard("桌面歌词 · 悬浮歌词") {
                    SettingSwitch("开启桌面歌词", "离开应用后也能在其他应用上方显示歌词，需授予显示悬浮窗权限。", desktopLyrics) { enabled ->
                        prefs.desktopLyrics = enabled
                        if (enabled && !Settings.canDrawOverlays(context)) {
                            try {
                                overlayPermission.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    "package:${context.packageName}".toUri()))
                            } catch (_: Exception) {
                                prefs.desktopLyrics = false
                                notice = "请在系统设置中为觅音开启显示悬浮窗权限"
                            }
                        } else {
                            desktopLyrics = enabled; DesktopLyrics.configure(context)
                        }
                    }
                    Text("歌词样式", style = MaterialTheme.typography.titleSmall)
                    ChoiceRow(DesktopLyrics.styles, lyricStyle) {
                        lyricStyle = it; prefs.lyricStyle = it; DesktopLyrics.configure(context)
                    }
                    Text("觅音 · 让喜欢的音乐陪伴你", fontWeight = FontWeight.Bold,
                        color = when (lyricStyle) {
                            "sky" -> androidx.compose.ui.graphics.Color(0xff499bc9)
                            "rose" -> androidx.compose.ui.graphics.Color(0xffd36d9f)
                            "classic" -> MaterialTheme.colorScheme.onSurface
                            else -> MaterialTheme.colorScheme.primary
                        }, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant).padding(18.dp))
                    ChoiceRow(listOf("20" to "小字", "26" to "标准", "34" to "大字"), lyricSize.toString()) {
                        lyricSize = it.toInt(); prefs.lyricSize = lyricSize; DesktopLyrics.configure(context)
                    }
                    SettingSwitch("双行显示", "同时展示当前句与下一句", lyricDouble) {
                        lyricDouble = it; prefs.lyricDoubleLine = it; DesktopLyrics.configure(context)
                    }
                    SettingSwitch("锁定歌词位置", "锁定后点击会穿透到下层应用；返回此处关闭即可继续拖动。", lyricLocked) {
                        lyricLocked = it; prefs.lyricLocked = it; DesktopLyrics.configure(context)
                    }
                    TextButton(onClick = { prefs.lyricY = 160; prefs.lyricLocked = false; lyricLocked = false; DesktopLyrics.configure(context) }) {
                        Text("重置歌词位置并解锁")
                    }
                }
            }
            item {
                SettingsCard("均衡器 EQ") {
                    SettingSwitch("启用均衡器", EqualizerEngine.status, eqEnabled) {
                        eqEnabled = it; prefs.eqEnabled = it; EqualizerEngine.apply(prefs)
                    }
                    ChoiceRow(EqualizerEngine.presets.map { it.id to it.name } + ("custom" to "自定义"), eqPreset) { id ->
                        eqPreset = id; prefs.eqPreset = id
                        gains = EqualizerEngine.gains(prefs)
                        EqualizerEngine.apply(prefs)
                    }
                    EqualizerEngine.labels.forEachIndexed { index, label ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(label, modifier = Modifier.weight(0.25f), style = MaterialTheme.typography.labelMedium)
                            Slider(value = gains[index], onValueChange = { value ->
                                gains = gains.toMutableList().also { it[index] = value }
                                eqPreset = "custom"; prefs.eqPreset = "custom"; prefs.eqCustomBands = gains
                                EqualizerEngine.apply(prefs)
                            }, valueRange = -12f..12f, steps = 23,
                                modifier = Modifier.weight(0.60f))
                            Text("${if (gains[index] > 0) "+" else ""}${gains[index].roundToInt()} dB",
                                modifier = Modifier.weight(0.15f), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    Text("预设可继续微调，自定义曲线会自动保存。", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = {
                        eqPreset = "custom"; prefs.eqPreset = "custom"
                        gains = List(5) { 0f }; prefs.eqCustomBands = gains; EqualizerEngine.apply(prefs)
                    }) { Text("重置为平直曲线") }
                }
            }
            item {
                SettingsCard("本地缓存") {
                    Text(cacheUsage, style = MaterialTheme.typography.bodyMedium)
                    Text("音乐缓存上限", style = MaterialTheme.typography.titleSmall)
                    ChoiceRow(listOf(128, 256, 512, 1024, 2048).map { it.toString() to if (it >= 1024) "${it / 1024} GB" else "$it MB" },
                        cacheLimit.toString()) { selected ->
                        cacheLimit = selected.toInt(); prefs.audioCacheMb = cacheLimit
                        scope.launch {
                            withContext(Dispatchers.IO) { PlaybackCache.resize(context, selected.toInt()) }
                            cacheUsage = usage()
                        }
                    }
                    Text("播放时自动缓存，超出上限会清理较早使用的音频。封面由图片缓存单独管理。",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(enabled = !clearing, onClick = {
                        scope.launch {
                            clearing = true
                            try {
                                withContext(Dispatchers.IO) {
                                    PlaybackCache.clear(context)
                                    context.imageLoader.diskCache?.clear()
                                    context.imageLoader.memoryCache?.clear()
                                }
                                cacheUsage = usage()
                                notice = "缓存已清理"
                            } catch (e: CancellationException) { throw e
                            } catch (_: Exception) { notice = "部分缓存正在使用，请稍后再试"
                            } finally { clearing = false }
                        }
                    }) { Text(if (clearing) "正在清理…" else "清理音频与封面缓存") }
                    notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
            item {
                SettingsCard("账号") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(user?.nickname ?: "未登录", style = MaterialTheme.typography.titleMedium)
                            Text(user?.roleText ?: "登录后同步收藏与歌单", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (user == null) Button(onClick = onLogin) { Text("登录") }
                        else TextButton(onClick = onLogout) { Text("退出登录") }
                    }
                }
            }
            item {
                Text("觅音 ${BuildConfig.VERSION_NAME}", modifier = Modifier.padding(8.dp),
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    ListEntrance {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.78f)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary)
            content()
        }
    }
}

@Composable
private fun ChoiceRow(choices: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(choices.size) { index ->
            val (id, name) = choices[index]
            FilterChip(selected == id, { onSelect(id) }, label = { Text(name) }, shape = RoundedCornerShape(50))
        }
    }
}

@Composable
private fun SettingSwitch(title: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
        .semantics(mergeDescendants = true) { contentDescription = title }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, onCheckedChange = null)
    }
}
