package com.miyin.mobile

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.setProgress
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import kotlin.math.roundToInt

/** App-owned overlay chrome: neutral glass tint, compact spacing and safe insets. */
@Composable
private fun AppOverlay(onDismissRequest: () -> Unit, sheet: Boolean, shape: Shape = RoundedCornerShape(30.dp), content: @Composable ColumnScope.() -> Unit) {
    val colors = MaterialTheme.colorScheme
    val maxHeight = LocalConfiguration.current.screenHeightDp.dp * .88f
    Dialog(onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0f) }
        var visible by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { visible = true }
        Box(Modifier.fillMaxSize().imePadding()) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .38f)).clickable(onClick = onDismissRequest))
            AnimatedVisibility(visible, modifier = Modifier.align(if (sheet) Alignment.BottomCenter else Alignment.Center)
                .statusBarsPadding().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp),
                enter = fadeIn(tween(180)) + slideInVertically(tween(260)) { if (sheet) it / 2 else it / 12 }) {
                Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().heightIn(max = maxHeight)
                    .clip(shape)
                    .background(Brush.verticalGradient(listOf(colors.surface, colors.background)))
                    .border(1.dp, colors.outline.copy(alpha = .28f), shape)
                    .clickable(enabled = false) {}.padding(20.dp),
                    content = content)
            }
        }
    }
}

@Composable
fun AppSheet(onDismissRequest: () -> Unit, title: String, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    AppOverlay(onDismissRequest, sheet = true) {
        Box(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 18.dp).size(32.dp, 4.dp)
            .clip(CircleShape).background(MaterialTheme.colorScheme.outline.copy(alpha = .5f)))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            AppClose(onDismissRequest)
        }
        subtitle?.let { androidx.compose.material3.Text(it, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp)) }
        Spacer(Modifier.height(16.dp))
        content()
    }
}

@Composable
fun AppDialog(onDismissRequest: () -> Unit, title: @Composable () -> Unit, text: @Composable () -> Unit,
    confirmButton: @Composable () -> Unit, dismissButton: (@Composable () -> Unit)? = null,
    shape: Shape = RoundedCornerShape(30.dp)) {
    AppOverlay(onDismissRequest, sheet = false, shape = shape) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { ProvideTextStyle(MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)) { title() } }
            AppClose(onDismissRequest)
        }
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(vertical = 18.dp)) {
            ProvideTextStyle(MaterialTheme.typography.bodyMedium) { text() }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            dismissButton?.invoke()
            confirmButton()
        }
    }
}

@Composable
fun AppClose(onClick: () -> Unit) {
    AppIconButton(onClick, Modifier.size(40.dp)) {
        Icon(Icons.Rounded.Close, "关闭", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun AppIconButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .94f else 1f,
        spring(dampingRatio = .75f, stiffness = 650f), label = "glass-icon-press")
    Box(modifier.defaultMinSize(minWidth = 44.dp, minHeight = 44.dp)
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .glassControlSurface(CircleShape, pressed = pressed).clip(CircleShape)
        .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center, content = content)
}

@Composable
fun AppButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(50), contentPadding: PaddingValues = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
    colors: androidx.compose.material3.ButtonColors? = null,
    content: @Composable RowScope.() -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val background = colors?.containerColor ?: scheme.primary
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) .97f else 1f, spring(dampingRatio = .75f, stiffness = 650f), label = "button-press")
    Row(modifier.alpha(if (enabled) 1f else .45f).graphicsLayer { scaleX = scale; scaleY = scale }.clip(shape)
        .background(Brush.linearGradient(listOf(background, background.copy(alpha = background.alpha * .82f))))
        .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = .15f), Color.Transparent)))
        .border(.75.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = .38f), Color.White.copy(alpha = .08f))), shape)
        .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
        .defaultMinSize(minHeight = 44.dp).padding(contentPadding),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        CompositionLocalProvider(LocalContentColor provides (colors?.contentColor ?: scheme.onPrimary)) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold)) { content() }
        }
    }
}

@Composable
fun AppTextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 10.dp), selected: Boolean = false,
    content: @Composable RowScope.() -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) .96f else 1f, spring(dampingRatio = .75f, stiffness = 650f), label = "glass-button-press")
    val shape = RoundedCornerShape(50)
    Row(modifier.alpha(if (enabled) 1f else .4f).graphicsLayer { scaleX = scale; scaleY = scale }
        .glassControlSurface(shape, selected, pressed).clip(shape)
        .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
        .defaultMinSize(minHeight = 44.dp).padding(contentPadding),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        CompositionLocalProvider(LocalContentColor provides if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium)) { content() }
        }
    }
}

@Composable
fun AppField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    label: (@Composable () -> Unit)? = null, singleLine: Boolean = false, maxLines: Int = Int.MAX_VALUE,
    placeholder: (@Composable () -> Unit)? = null, leadingIcon: (@Composable () -> Unit)? = null, trailingIcon: (@Composable () -> Unit)? = null,
    shape: Shape = RoundedCornerShape(16.dp), visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default) {
    val colors = MaterialTheme.colorScheme
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        if (label != null) CompositionLocalProvider(LocalContentColor provides colors.onSurfaceVariant) {
            ProvideTextStyle(MaterialTheme.typography.labelMedium) { label() }
        }
        BasicTextField(value, onValueChange, enabled = enabled, singleLine = singleLine, maxLines = maxLines,
            visualTransformation = visualTransformation, keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
            interactionSource = interaction,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.onSurface), cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.primary),
            modifier = Modifier.fillMaxWidth().clip(shape).background(colors.onSurface.copy(alpha = .045f))
                .border(1.dp, if (focused) colors.primary.copy(alpha = .7f) else colors.outline.copy(alpha = .35f), shape).padding(horizontal = 15.dp, vertical = 12.dp),
            decorationBox = { field ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    leadingIcon?.invoke()
                    Box(Modifier.weight(1f).heightIn(min = 24.dp), contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty() && placeholder != null) CompositionLocalProvider(LocalContentColor provides colors.onSurfaceVariant) { placeholder() }
                        field()
                    }
                    trailingIcon?.invoke()
                }
            })
    }
}

@Composable
fun AppChoiceChip(selected: Boolean, onClick: () -> Unit, label: @Composable () -> Unit, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(50)) {
    val colors = MaterialTheme.colorScheme
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .96f else 1f,
        spring(dampingRatio = .75f, stiffness = 650f), label = "glass-choice-press")
    Row(modifier.graphicsLayer { scaleX = scale; scaleY = scale }.glassControlSurface(shape, selected, pressed).clip(shape)
        .selectable(selected, interactionSource = interaction, indication = null, role = Role.RadioButton, onClick = onClick)
        .heightIn(min = 44.dp).padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (selected) Icon(Icons.Rounded.Check, null, Modifier.size(14.dp), tint = colors.primary)
        CompositionLocalProvider(LocalContentColor provides if (selected) colors.primary else colors.onSurfaceVariant) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge) { label() }
        }
    }
}

@Composable
fun AppSwitchIndicator(checked: Boolean) {
    val progress by animateFloatAsState(if (checked) 1f else 0f, tween(180), label = "switch")
    Box(Modifier.size(46.dp, 28.dp).clip(CircleShape)
        .background(if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = .65f))) {
        Box(Modifier.padding(3.dp).offset(x = 18.dp * progress).size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface))
    }
}

@Composable
fun AppMenu(expanded: Boolean, onDismissRequest: () -> Unit, title: String, subtitle: String, content: @Composable ColumnScope.() -> Unit) {
    if (expanded) AppSheet(onDismissRequest, title, subtitle) {
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable
fun AppMenuItem(text: @Composable () -> Unit, onClick: () -> Unit, enabled: Boolean = true) {
    AppTextButton(onClick, Modifier.fillMaxWidth(), enabled, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)) {
        Box(Modifier.weight(1f)) { text() }
    }
}

/** Compact drawn slider with a full 48dp touch target and accessible progress actions. */
@Composable
fun AppSlider(value: Float, onValueChange: (Float) -> Unit, modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f, steps: Int = 0, onValueChangeFinished: (() -> Unit)? = null) {
    val colors = MaterialTheme.colorScheme
    var width by remember { mutableStateOf(1f) }
    val update by rememberUpdatedState(onValueChange)
    val finish by rememberUpdatedState(onValueChangeFinished)
    val latest by rememberUpdatedState(value)
    fun quantize(input: Float): Float {
        val fraction = ((input - valueRange.start) / (valueRange.endInclusive - valueRange.start)).coerceIn(0f, 1f)
        val snapped = if (steps > 0) (fraction * (steps + 1)).roundToInt().toFloat() / (steps + 1) else fraction
        return valueRange.start + snapped * (valueRange.endInclusive - valueRange.start)
    }
    fun change(x: Float) {
        update(quantize(valueRange.start + (x / width).coerceIn(0f, 1f) * (valueRange.endInclusive - valueRange.start)))
    }
    Canvas(modifier.fillMaxWidth().height(48.dp).padding(horizontal = 10.dp).onSizeChanged { width = it.width.toFloat().coerceAtLeast(1f) }
        .semantics { progressBarRangeInfo = ProgressBarRangeInfo(value.coerceIn(valueRange), valueRange, steps)
            setProgress { update(quantize(it)); finish?.invoke(); true } }
        .onKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key in listOf(Key.DirectionLeft, Key.DirectionRight)) {
                val delta = (valueRange.endInclusive - valueRange.start) / (if (steps > 0) steps + 1 else 20)
                update(quantize(latest + if (it.key == Key.DirectionRight) delta else -delta)); finish?.invoke(); true
            } else false
        }.focusable()
        .pointerInput(valueRange, steps) { detectTapGestures { change(it.x); finish?.invoke() } }
        .pointerInput(valueRange, steps) { detectHorizontalDragGestures(onDragStart = { change(it.x) },
            onDragEnd = { finish?.invoke() }, onDragCancel = { finish?.invoke() }) { event, _ -> event.consume(); change(event.position.x) } }) {
        val x = ((value - valueRange.start) / (valueRange.endInclusive - valueRange.start)).coerceIn(0f, 1f) * size.width
        drawLine(colors.onSurface.copy(alpha = .12f), Offset(0f, center.y), Offset(size.width, center.y), 4.dp.toPx(), StrokeCap.Round)
        drawLine(colors.primary, Offset(0f, center.y), Offset(x, center.y), 4.dp.toPx(), StrokeCap.Round)
        drawCircle(colors.primary.copy(alpha = .12f), 12.dp.toPx(), Offset(x, center.y))
        drawCircle(colors.primary, 7.dp.toPx(), Offset(x, center.y))
        drawCircle(colors.surface, 2.5.dp.toPx(), Offset(x, center.y))
    }
}
