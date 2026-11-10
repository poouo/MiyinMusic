# 设备 API v1

用于智能音箱、AI 硬件和自动化程序。接口根路径为 `https://你的站点/api/v1`，与现有 Web / Android / Windows 内部接口分开。播放与下载只返回音源直链，**完整音频由设备直连上游，本站不代理、不下载或预热该请求的音频文件**。音源解析仍保留必要的有限片段校验，以排除可识别的不完整歌曲。

机器可读文档：`GET /api/v1/openapi.json`，可导入支持 OpenAPI 3.0 的客户端。MCP 使用同一套用户与密钥权限，见 [小智 AI / MCP](xiaozhi-mcp.md)。

## 开启与用户管理

1. 管理员进入 `/admin/` →「设备 API」，开启总开关，选择允许的角色并保存。升级默认关闭；初始允许角色为管理员。
2. 如只允许个别账号，到「用户管理 → 编辑 → 设备 API 权限」，选择「单独允许」。也可「单独禁止」某个已获角色授权的用户。单用户允许仍不能绕过总开关。
3. 用户进入前台「设置 → 设备 API」，创建设备密钥，填写名称、权限和有效期。每个账号最多 10 个有效密钥，有效期为 1–365 天或长期有效。
4. 用户可随时编辑名称 / 权限或删除自己的密钥。修改不需要重新复制密钥；不支持读取他人的密钥。管理员可撤销密钥，但无法恢复完整密钥。

密钥形如 `myk_…`，完整内容只显示一次。服务端仅保存 SHA-256 摘要；列表只显示前缀、权限、到期时间和最近使用时间。设备密钥不能登录账号、修改资料、创建更多密钥或进入管理后台。使用 HTTPS 保存和传递密钥。

## 鉴权与权限

除 OpenAPI 文档外，JSON 接口必须带：

```http
Authorization: Bearer myk_你的完整密钥
Content-Type: application/json
```

不接受查询参数中的密钥，也不使用 Web 登录 Cookie。

| 权限 | 允许的操作 |
| --- | --- |
| `search` | 搜索歌曲 |
| `playback` | 解析播放直链 |
| `download` | 解析下载直链 |
| `lyrics` | 读取歌词 |
| `library` | 只读访问当前用户自己的歌单和「我的喜欢」 |

总开关、用户角色、单用户授权、账号状态、密钥有效期和操作权限共同决定访问资格。账号禁用、删除密钥或关闭 API 会阻止后续 API / MCP 调用；**已发出的上游直链不受本站控制，无法远程撤销**。

同一用户的所有密钥共用每分钟请求数，默认 60 次，后台可配置 10–600。不同账号分别计数，不占用浏览器自身的限流额度。超限返回 HTTP 429 和 `Retry-After: 60`。

## 平台与音质

| 参数 | 值 |
| --- | --- |
| `platform` | `kw` 酷我、`kg` 酷狗、`tx` QQ 音乐、`wy` 网易云、`mg` 咪咕 |
| `quality` | `128k` 标准、`320k` 高品质、`flac` 无损、`flac24bit` Hi-Res |
| `fallback` | 布尔值，默认 `false`；`true` 时允许向下尝试可用音质 |

播放和下载均由设备每次指定音质，不设置用户或密钥的默认音质配置。请求省略 `quality` 时使用 `320k`。性能有限的设备应显式传 `128k`。

- `quality: "flac24bit", fallback: true`：依次尝试 Hi-Res → 无损 → 高品质 → 标准，且不会超过账号允许的音质。
- `quality: "flac24bit", fallback: false` 或省略 `fallback`：只尝试 Hi-Res；不可用直接报错。
- `quality: "128k", fallback: true`：仍只尝试标准，绝不向上升级。
- 布尔值必须是 JSON `true` / `false`，不能使用字符串 `"true"`。

账号完全没有所请求音质权限时返回 403；音源不支持或解析失败时返回 502；超时返回 504。`fallback: true` 可降级到账号允许的较低音质。响应 `quality` 始终表示实际返回的音质。

## 搜索歌曲

`GET /search`，需要 `search` 权限。

| 参数 | 必填 | 默认 / 范围 |
| --- | --- | --- |
| `q` | 是 | 歌名、歌手或关键词，1–100 字符 |
| `platform` | 否 | `wy` |
| `page` | 否 | 1，最大 10000 |
| `limit` | 否 | 20，最大 50 |

```bash
curl -G 'https://你的站点/api/v1/search' \
  -H "Authorization: Bearer $MIYIN_API_KEY" \
  --data-urlencode 'q=周杰伦 晴天' \
  --data-urlencode 'platform=tx' --data-urlencode 'limit=5'
```

响应为 `{ "result": { "platform", "list": [歌曲对象], "total", "page", "limit", "hasMore" } }`。

**保存搜索返回的完整歌曲对象，后续请求直接放在 `song` 中。** 不要只保留歌名或 ID：酷狗 `hash`、QQ `strMediaMid` 等字段可能是解析所必需的。`interval` 为秒数，可用于排除短试听；`qualities` 为平台提示，最终是否可用以实际音源解析为准。

## 播放直链

`POST /playback`，需要 `playback` 权限。请求示例（`song` 应替换为真实搜索结果的完整对象）：

```json
{
  "song": {
    "platform": "wy",
    "songmid": "搜索结果的歌曲ID",
    "name": "歌曲名",
    "singer": "歌手",
    "albumName": "专辑",
    "interval": 240,
    "qualities": ["128k", "320k"]
  },
  "quality": "128k",
  "fallback": true
}
```

```json
{
  "url": "https://音源域名/path/song.mp3?上游凭据",
  "delivery": "direct",
  "expiresAt": null,
  "quality": "128k",
  "requestedQuality": "128k",
  "downgraded": false,
  "duration": 240,
  "platform": "wy"
}
```

设备把 `url` 直接交给自身播放器，**不要往音源域名发送本站的 Authorization 密钥**。返回的不是 `/api/stream` 地址，也不会以本站缓存文件作为设备音频来源。

音源有效期通常无法可靠获取，因此 `expiresAt` 返回 `null`，不承诺固定时长。链接失效后重新解析。Range、TLS、解码格式、IP / 地区和防盗链规则由上游决定；服务器解析成功不等于每台设备、每个网络都能访问，本站不通过代理兜底。

## 下载直链

`POST /download`，需要 `download` 权限。请求字段与播放相同，返回播放响应字段并增加 `filename`，作为设备保存文件的建议名称。

下载直链遵循账号下载开关、音质与日 / 月次数。**成功返回直链时计 1 次**，与 Web 共用次数；解析失败不扣除。并发解析在事务内扣次数，不会并发超额。本站不统计设备直连的实际下载字节数，也不能限制一条上游链接被设备重复使用。

如果账号配置了日 / 月下载流量上限，设备直链下载返回 HTTP 403、`direct_download_byte_quota`，以免绕过管理员的流量额度。该用户仍可按原规则使用站内下载；需要设备直链下载时，应由管理员为该角色取消流量上限，可保留次数上限。关闭整个会员限制后，沿用现有系统的不限额策略。

## 歌词与音乐库

| 接口 | 请求 / 响应 | 权限 |
| --- | --- | --- |
| `POST /lyrics` | 请求 `{ "song": 完整歌曲对象 }`；响应 `{ "lyric": { "lyric", "tlyric?", "lxlyric?" } }` | `lyrics` |
| `GET /playlists` | 响应 `{ "playlists": [{ "id", "name", "description", "songCount", "createdAt", "updatedAt" }] }` | `library` |
| `GET /playlists/{id}` | 响应 `{ "playlist": { "id", "name", "description", "songs": [], "createdAt", "updatedAt" } }` | `library` |
| `GET /favorites?page=1&limit=20` | 响应 `{ "songs": [], "page", "limit", "total", "hasMore" }`，limit 最大 100 | `library` |
| `GET /me` | 当前用户公开资料、密钥元数据、API 授权、账号音质权限和用量 | 任一有效密钥 |
| `GET /capabilities` | 平台、音质、密钥权限、`mediaUrlMode: "direct"` 和 MCP 地址 | 任一有效密钥 |

所有时间戳为 UTC Unix 毫秒。歌单和喜欢仅访问密钥所属账号，不能传用户 ID 访问其他账号；这些接口不提供修改音乐库的能力。歌单摘要查询不加载全部歌曲，减少硬件轮询时的服务器负担。

## 错误与重试

```json
{"error":{"code":"quality_unavailable","message":"请求的音质暂时不可用或音源解析失败"}}
```

| HTTP | 常见 code | 处理 |
| --- | --- | --- |
| 400 | `invalid_parameter` / `error` | 修正参数，不重复提交错误请求 |
| 401 | `invalid_api_key` | 密钥删除、过期或错误；更新配置 |
| 403 | `device_api_disabled` / `device_api_forbidden` | 总开关关闭或用户未获授权 |
| 403 | `insufficient_scope` | 用户在自己的设置中调整设备权限 |
| 403 | `quality_forbidden` / `playback_forbidden` / `download_forbidden` | 账号音质或下载权限不足 |
| 403 | `direct_download_byte_quota` | 直链无法核验账号的流量上限 |
| 404 | `not_found` | 歌单或接口不存在，或不属于本人 |
| 429 | `rate_limited` / `download_quota_exceeded` | 遵循 Retry-After / 下载额度，不连续重试 |
| 502 | `quality_unavailable` / `invalid_upstream_url` | 换平台、换音质，或显式开启 fallback |
| 504 | `upstream_timeout` | 稍后再试 |

## Python 搜索并解析示例

仅使用标准库，完整歌曲对象原样回传，不下载音频：

```python
import json, os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

base = os.environ["MIYIN_BASE_URL"].rstrip("/")
key = os.environ["MIYIN_API_KEY"]

def api(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = Request(base + "/api/v1" + path, data=data, headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json"
    })
    with urlopen(request, timeout=25) as response:
        return json.load(response)

songs = api("/search?" + urlencode({"q": "晴天 周杰伦", "platform": "tx", "limit": 5}))["result"]["list"]
if songs:
    media = api("/playback", {"song": songs[0], "quality": "128k", "fallback": True})
    print(media["url"])  # 交给硬件自身播放器；不要向该地址发送本站 key
```
