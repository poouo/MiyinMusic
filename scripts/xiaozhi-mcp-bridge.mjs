import { XiaozhiMcpBridge } from '../server/dist/xiaozhi-bridge.js'

const { MCP_ENDPOINT, MIYIN_MCP_URL = 'http://127.0.0.1:3000/api/v1/mcp', MIYIN_API_KEY } = process.env
if (!MCP_ENDPOINT || !MIYIN_API_KEY) {
  console.error('请设置 MCP_ENDPOINT（小智后台的 MCP 接入点）、MIYIN_API_KEY（个人设备密钥）及 MIYIN_MCP_URL。')
  process.exit(1)
}
try {
  const bridge = new XiaozhiMcpBridge({ endpoint: MCP_ENDPOINT, mcpUrl: MIYIN_MCP_URL, apiKey: MIYIN_API_KEY,
    log: message => console.log(new Date().toISOString(), message) })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { bridge.stop(); process.exit(0) })
  bridge.start()
} catch {
  console.error('桥接配置无效，请检查 MCP_ENDPOINT、MIYIN_MCP_URL 和 MIYIN_API_KEY。')
  process.exit(1)
}
