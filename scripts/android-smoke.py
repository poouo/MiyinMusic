"""Exercise the Android build by accessibility labels and save reviewable screenshots."""
import argparse
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("--output", default=".")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)


def adb(*args):
    return subprocess.check_output(["adb", *args])


def nodes():
    adb("shell", "uiautomator", "dump", "/sdcard/miyin-window.xml")
    return ET.fromstring(adb("exec-out", "cat", "/sdcard/miyin-window.xml")).iter("node")


def tap(label):
    for node in nodes():
        if label not in (node.get("text"), node.get("content-desc")):
            continue
        bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
        if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
            adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))
            time.sleep(1)
            return
    raise RuntimeError(f"Missing accessible control: {label}")


def scroll_to(label):
    for _ in range(8):
        if any(label in (node.get("text"), node.get("content-desc")) for node in nodes()):
            return
        adb("shell", "input", "swipe", str(width // 2), str(height * 3 // 4), str(width // 2), str(height // 3), "450")
    raise RuntimeError(f"Missing settings section: {label}")


def screenshot(name):
    (output / ("screenshot-" + name + ".png")).write_bytes(adb("exec-out", "screencap", "-p"))


adb("logcat", "-c")
adb("shell", "am", "start", "-W", "-n", "com.miyin.mobile/.MainActivity")
time.sleep(15)
screenshot("home")
width, height = map(int, re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size").decode())[-1])
adb("shell", "input", "swipe", str(width // 2), str(height * 3 // 4), str(width // 2), str(height // 3), "500")
time.sleep(1)
screenshot("home-scrolled")
tap("我的")
tap("设置")
screenshot("settings")
scroll_to("桌面歌词 · 悬浮歌词")
screenshot("desktop-lyrics-settings")
scroll_to("均衡器 EQ")
screenshot("equalizer")
adb("shell", "input", "keyevent", "4")
tap("发现")
for _ in range(2):
    adb("shell", "input", "swipe", str(width // 2), str(height // 3), str(width // 2), str(height * 3 // 4), "400")
time.sleep(1)
tap("每日推荐")
time.sleep(10)
screenshot("now-portrait")
tap("展开歌词")
screenshot("lyrics")
tap("播放列表")
screenshot("queue")
adb("shell", "input", "keyevent", "4")
adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
adb("shell", "settings", "put", "system", "user_rotation", "1")
time.sleep(3)
screenshot("now-landscape")
adb("shell", "settings", "put", "system", "user_rotation", "0")
adb("shell", "cmd", "statusbar", "expand-notifications")
time.sleep(2)
screenshot("notification")
adb("shell", "cmd", "statusbar", "collapse")
logs = adb("logcat", "-d", "-t", "2500")
(output / "logcat.txt").write_bytes(logs)
if re.search(rb"FATAL EXCEPTION[^\n]*\n(?:[^\n]*\n){0,3}[^\n]*Process: com\.miyin\.mobile", logs):
    raise RuntimeError("Android crash found; inspect logcat.txt")
