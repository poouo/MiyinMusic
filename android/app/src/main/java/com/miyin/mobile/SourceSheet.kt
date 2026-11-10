package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

@Composable
fun SourceSheet(api: ApiClient, player: PlayerController, onClose: () -> Unit) {
    var sources by remember { mutableStateOf<List<PlaybackSource>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val platform = player.current?.platform
    LaunchedEffect(platform) {
        loading = true
        try { sources = api.sources().filter { it.enabled && it.status == "ready" && it.platforms.any { p -> p.platform == platform && "musicUrl" in p.actions } } }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = "暂时无法获取播放源，请稍后重试" }
        finally { loading = false }
    }
    val colors = MaterialTheme.colorScheme
    AppSheet(onClose, "播放源", "当前：${player.sourceName.ifBlank { "等待解析" }} · 切换保留进度") {
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val options = listOf(PlaybackSource(id = "", name = "自动选择")) + sources
            options.forEach { source ->
                val selected = player.selectedSourceId.orEmpty() == source.id
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
                    .background(if (selected) colors.primary.copy(alpha = .12f) else colors.onSurface.copy(alpha = .04f))
                    .clickable { player.changeSource(source.id.ifBlank { null }); onClose() }.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(source.name + if (selected) "  ✓" else "", fontWeight = FontWeight.SemiBold, color = if (selected) colors.primary else colors.onSurface)
                    val qualities = source.platforms.firstOrNull { it.platform == platform }?.qualitys.orEmpty()
                    Text(if (source.id.isBlank()) "按后台优先级选择，跳过异常与不完整音频" else
                        qualities.map { q -> audioQualities.firstOrNull { it.first == q }?.second ?: q }.joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
            }
            if (loading) Text("正在获取支持的播放源…", style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it, color = colors.error, style = MaterialTheme.typography.bodySmall) }
            Text("这里只显示支持当前歌曲平台的已启用音源；具体歌曲以实际解析结果为准。", color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}
