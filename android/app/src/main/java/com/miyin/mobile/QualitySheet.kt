package com.miyin.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

val audioQualities = listOf("128k" to "标准", "320k" to "高品质", "flac" to "无损", "flac24bit" to "Hi-Res")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QualitySheet(player: PlayerController, onClose: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Text("播放音质", style = MaterialTheme.typography.titleLarge)
            Text("当前实际音质：${player.qualityLabel.ifBlank { "读取中" }} · 不可用时自动回退",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 10.dp))
            audioQualities.forEachIndexed { index, (value, label) ->
                ListEntrance(index) {
                    Row(Modifier.fillMaxWidth().clickable { player.changeQuality(value); onClose() }
                        .padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(player.preferredQuality == value, onClick = { player.changeQuality(value); onClose() })
                        Text(label, style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
            Text("切换会保留当前进度，并记为默认音质。", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
    }
}
