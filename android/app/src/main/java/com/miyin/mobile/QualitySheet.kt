package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

val audioQualities = listOf("128k" to "标准", "320k" to "高品质", "flac" to "无损", "flac24bit" to "Hi-Res")

@Composable
fun QualitySheet(player: PlayerController, onClose: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    AppSheet(onClose, "播放音质", "选择默认音质，切换时保留当前播放进度") {
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.primary.copy(alpha = .09f)).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text("当前实际播放", style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
                Text(player.qualityLabel.ifBlank { "解析中…" }, color = colors.primary, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            }
            audioQualities.forEachIndexed { index, (value, label) ->
                val selected = player.preferredQuality == value
                val supported = player.current?.qualities.orEmpty().contains(value)
                val description = when (value) {
                    "128k" -> "128 kbps · 节省流量"
                    "320k" -> "320 kbps · 清晰耐听"
                    "flac" -> "FLAC · 保留更多声音细节"
                    else -> "24-bit · 高解析音频"
                }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
                    .background(if (selected) colors.primary.copy(alpha = .1f) else colors.onSurface.copy(alpha = .035f))
                    .border(1.dp, if (selected) colors.primary.copy(alpha = .6f) else colors.outline.copy(alpha = .2f), RoundedCornerShape(18.dp))
                    .selectable(selected, role = Role.RadioButton, onClick = { player.changeQuality(value); onClose() })
                    .padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(colors.primary.copy(alpha = .1f)), contentAlignment = Alignment.Center) {
                        Text(listOf("SD", "HQ", "SQ", "HR")[index], color = colors.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text(description, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                        Text(if (supported) "本曲平台标注支持" else "本曲未标注此音质 · 可设为默认", style = MaterialTheme.typography.labelSmall,
                            color = if (supported) colors.primary else colors.onSurfaceVariant)
                    }
                    if (selected) Icon(Icons.Rounded.Check, "已选择", Modifier.size(22.dp), tint = colors.primary)
                }
            }
            Text("平台标注仅供参考，实际可播放音质以音源返回为准；不可用时自动回退。", style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
