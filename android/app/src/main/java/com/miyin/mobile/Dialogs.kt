package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun LoginDialog(api: ApiClient, onClose: () -> Unit, onSuccess: (User) -> Unit) {
    var register by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var nickname by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun submit() {
        if (loading) return
        if (username.isBlank() || password.isBlank()) { error = "请输入账号和密码"; return }
        loading = true; error = null
        scope.launch {
            try { onSuccess(if (register) api.register(username.trim(), password, nickname.trim()) else api.login(username.trim(), password)) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.userMessage(if (register) "注册失败，请稍后重试" else "登录失败，请稍后重试") }
            finally { loading = false }
        }
    }
    AppDialog(onDismissRequest = { if (!loading) onClose() }, title = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.MusicNote, null, tint = MaterialTheme.colorScheme.primary)
            }
            Text(if (register) "加入觅音" else "欢迎回来", fontWeight = FontWeight.Bold)
        }
    }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("让喜欢的音乐，始终在你身边。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.onSurface.copy(alpha = .045f)).padding(4.dp)) {
                for ((label, mode) in listOf("登录" to false, "注册" to true)) {
                    Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp))
                        .background(if (register == mode) MaterialTheme.colorScheme.surface else androidx.compose.ui.graphics.Color.Transparent)
                        .selectable(register == mode, enabled = !loading, role = Role.Tab, onClick = { register = mode; error = null }).padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                        Text(label, fontWeight = FontWeight.SemiBold, color = if (register == mode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            AppField(username, { username = it }, enabled = !loading, label = { Text("账号") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
            AppField(password, { password = it }, enabled = !loading, label = { Text("密码") }, singleLine = true,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (register) ImeAction.Next else ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }), trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (showPassword) "隐藏密码" else "显示密码", Modifier.size(19.dp))
                    }
                })
            if (register) AppField(nickname, { nickname = it }, enabled = !loading, label = { Text("昵称（可选）") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }))
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Text("登录后同步收藏、歌单与播放记录", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }, confirmButton = {
        AppButton(onClick = { submit() }, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
            else Text(if (register) "注册并登录" else "登录觅音")
        }
    })
}
