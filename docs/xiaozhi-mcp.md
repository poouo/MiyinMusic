# 小智 AI / MCP 接入

觅音同时提供 HTTP API 与 MCP，使用同一个用户设备密钥。MCP 工具只搜索音乐、读取账号自己的歌单 / 喜欢及返回音源直链，**不会代理音频，也不会自行修改硬件固件**。API 参数与权限见 [设备 API](device-api.md)。

## 准备密钥

管理员在后台「设备 API」开启总开关并授权用户。用户到自己的「设置 → 设备 API」创建一个独立密钥，例如「小智音箱」，建议先勾选搜索、在线播放；需要歌词 / 音乐库 / 下载时再勾选相应权限。完整密钥只显示一次，请保存到连接程序的环境变量中。

删除密钥、关闭 API、禁用用户或撤回用户授权后，后续 MCP 请求会失败。已有上游歌曲直链无法由本站撤销。每个用户的密钥、权限与歌单互相隔离。

## 标准 HTTP MCP

- 地址：`https://你的站点/api/v1/mcp`
- 传输：Streamable HTTP，使用 POST；支持 JSON 响应，不提供旧式独立 SSE 地址。
- 鉴权：`Authorization: Bearer myk_你的设备密钥`。
- Accept：`application/json, text/event-stream`。
- 支持 MCP `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 等标准消息；使用官方 TypeScript MCP SDK。
- 无状态传输，不返回 `Mcp-Session-Id`，每次请求重新鉴权，避免跨用户复用会话身份。
- 每个 HTTP 请求发送一条 JSON-RPC 消息，不接受批量数组，确保调用频率按请求核验。

支持 HTTP MCP 的客户端可以参考：

```json
{
  "mcpServers": {
    "miyin": {
      "type": "http",
      "url": "https://你的站点/api/v1/mcp",
      "headers": { "Authorization": "Bearer myk_你的设备密钥" }
    }
  }
}
```

不同客户端的配置字段可能略有区别，端点和鉴权头一致。MCP 工具使用与 REST 相同的音质参数：`quality` 默认 `320k`，`fallback` 默认 `false`；性能有限的设备选择 `128k`，需要向下兼容时显式传 `fallback: true`。

## 小智官方的 WebSocket 接入点

小智后台常见的 MCP 接入点是 `wss://…/mcp/?token=…`，需要连接程序**主动连接小智**。不能把这个地址直接当作觅音 HTTP API，或把觅音 HTTP 地址直接填入仅接受 WebSocket 的入口。

本项目附带 `scripts/xiaozhi-mcp-bridge.mjs`。它将小智的 JSON-RPC WebSocket 消息转到当前用户的 HTTP MCP，返回工具结果；支持心跳、断线退避重连、并发上限和请求超时，不在日志中输出小智接入点 token 或觅音设备密钥。该连接只传工具消息，不传音乐音频。

### Docker 部署（推荐）

先更新为包含 MCP 的新版服务端镜像。在 `docker-compose.yml` 所在目录的 `.env` 中填入你自己的值（不要提交这个文件）：

```dotenv
XIAOZHI_MCP_ENDPOINT=wss://小智后台给出的完整地址/mcp/?token=你的接入点token
XIAOZHI_MIYIN_API_KEY=myk_你的设备密钥
```

同时放置仓库的 `docker-compose.xiaozhi.yml`，启动可选的桥接容器：

```bash
docker compose -f docker-compose.yml -f docker-compose.xiaozhi.yml --profile xiaozhi up -d
docker compose -f docker-compose.yml -f docker-compose.xiaozhi.yml --profile xiaozhi logs -f miyin-xiaozhi
```

该容器使用与主服务相同的镜像，在 Docker 内连接 `http://miyin:3000/api/v1/mcp`，不需要额外开放端口。默认 Compose 部署不会自动创建桥接容器；需要接入小智时才启用此 profile。每个桥接容器使用一个用户的独立密钥和一个小智接入点；多用户可按此模板创建多个桥接服务。

### 本机运行

需要 Node.js 22+，在项目根目录先安装依赖并编译服务端：

```bash
npm ci
npm --workspace server run build
export MCP_ENDPOINT='wss://小智后台给出的完整接入点'
export MIYIN_API_KEY='myk_你的设备密钥'
export MIYIN_MCP_URL='https://你的站点/api/v1/mcp'
node scripts/xiaozhi-mcp-bridge.mjs
```

PowerShell：

```powershell
$env:MCP_ENDPOINT='wss://小智后台给出的完整接入点'
$env:MIYIN_API_KEY='myk_你的设备密钥'
$env:MIYIN_MCP_URL='https://你的站点/api/v1/mcp'
node scripts/xiaozhi-mcp-bridge.mjs
```

看到「小智 MCP 已连接」后，回小智后台检查工具列表。若长期未出现工具，检查总开关、用户授权、密钥是否有效，以及桥接机器能否连接两个服务。仅凭本地协议测试不能证明你的具体小智接入点或硬件已联通。

也可使用[小智官方 MCP 示例的 mcp_pipe](https://github.com/78/mcp-calculator)，把上面的 HTTP MCP 配置填到它的 `mcp_config.json`；它支持 HTTP → WebSocket 桥接。本项目的自带桥接无需额外安装 Python。

## 工具列表

工具按设备密钥权限过滤；未授权的工具不会出现在 `tools/list`，即使手工调用也无法绕过权限。

| 工具 | 主要参数 | 权限 |
| --- | --- | --- |
| `miyin_account` | 无 | 任一有效密钥 |
| `miyin_search_music` | `query`、`platform`、`page`、`limit` | search |
| `miyin_get_playback_url` | `song_json`、`quality`、`fallback` | playback |
| `miyin_find_playback_url` | `query`、`platform`、`quality`、`fallback`；搜索后解析第一首 | search + playback |
| `miyin_get_download_url` | `song_json`、`quality`、`fallback`；成功签发扣 1 次下载次数 | download |
| `miyin_get_lyrics` | `song_json` | lyrics |
| `miyin_list_playlists` | 无 | library |
| `miyin_get_playlist` | `id` | library |
| `miyin_get_favorites` | `page`、`limit` | library |

`song_json` 是搜索 / 歌单返回的完整歌曲对象经过 JSON 序列化后的字符串，保留各平台专用字段。结果同时提供 MCP 文本内容和结构化 JSON；业务失败为 `isError: true`，其中包含与 REST 对齐的 `error.code`、`status`、`message`。

## 让小智实际播放音乐

可用这样的意图请求工具：「搜索周杰伦的晴天，获取标准音质播放直链，允许降级。」`miyin_find_playback_url` 会返回歌曲、实际音质和音源 URL，并明确 `playbackStarted: false`。

**MCP 返回 URL 本身不会让普通小智固件开始播放 MP3 / FLAC。** 如果固件已有 URL 音乐播放工具，AI / 宿主需要把该 URL 交给它；否则还需要为对应硬件增加 HTTP 音频下载、解码和播放能力。这与觅音服务端 API / MCP 接口分别部署。标准小智通用工具中有音量控制，并不等同于通用 URL 音乐播放器。Hi-Res / FLAC 尤其需要硬件与固件解码支持。

协议参考：[小智官方 MCP 示例](https://github.com/78/mcp-calculator)、[小智官方 MCP 使用说明](https://github.com/78/xiaozhi-esp32/blob/main/docs/mcp-usage.md)。
