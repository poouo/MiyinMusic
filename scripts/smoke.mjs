#!/usr/bin/env node
/**
 * 接口自检：对运行中的服务做端到端检查（搜索 -> 取地址 -> 拉流 -> 歌词 -> 账号 -> 音乐库）
 * 用法：npm run smoke [http://127.0.0.1:3000]
 */
const BASE = process.argv[2] || process.env.MIYIN_BASE || 'http://127.0.0.1:3000'
const results = []
const pass = (name, extra) => results.push(['PASS', name, String(extra ?? '')])
const fail = (name, extra) => results.push(['FAIL', name, String(extra ?? '')])

async function api(path, init) {
  const response = await fetch(BASE + path, init)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text, headers: response.headers }
}

const post = (path, body, headers = {}) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function main() {
  const health = await api('/api/health')
  health.status === 200 ? pass('服务健康') : fail('服务健康', health.text)

  const sources = await api('/api/sources')
  const ready = (sources.json?.sources ?? []).filter((source) => source.status === 'ready')
  ready.length > 0 ? pass('音源就绪', ready.length + ' 个') : fail('音源就绪', '没有可用音源')

  for (const platform of ['kw', 'kg', 'tx', 'wy', 'mg']) {
    const search = await api('/api/search?platform=' + platform + '&q=' + encodeURIComponent('晴天 周杰伦') + '&limit=3')
    if (search.status !== 200) {
      fail('搜索 ' + platform, search.text.slice(0, 120))
      continue
    }
    const song = search.json.result.list[0]
    if (!song) {
      fail('搜索 ' + platform, '无结果')
      continue
    }
    pass('搜索 ' + platform, song.name + ' · ' + (song.qualities.join('/') || '-'))

    const url = await post('/api/url', { song })
    if (url.status !== 200) {
      fail('播放地址 ' + platform, url.text.slice(0, 140))
      continue
    }
    pass('播放地址 ' + platform, url.json.quality + ' via ' + url.json.sourceName)

    const stream = await fetch(BASE + url.json.playUrl, { headers: { Range: 'bytes=0-32767' } })
    const buffer = Buffer.from(await stream.arrayBuffer())
    stream.status === 206 && buffer.length > 0
      ? pass('音频流 ' + platform, buffer.length + ' 字节')
      : fail('音频流 ' + platform, 'HTTP ' + stream.status)

    const lyric = await post('/api/lyric', { song })
    lyric.status === 200 && lyric.json.lyric.lyric
      ? pass('歌词 ' + platform, lyric.json.lyric.lyric.split('\n').length + ' 行')
      : fail('歌词 ' + platform, lyric.text.slice(0, 120))
  }

  const username = 'smoke' + Math.random().toString(36).slice(2, 8)
  const register = await post('/api/auth/register', { username, password: 'smoke123456', nickname: '自检' })
  if (register.status === 200) {
    pass('注册', username)
  } else if (register.status === 403) {
    pass('注册', '服务器已关闭注册，跳过')
  } else {
    fail('注册', register.text.slice(0, 120))
  }

  if (register.status === 200) {
    const cookie = (register.headers.get('set-cookie') || '').split(';')[0]
    const me = await api('/api/auth/me', { headers: { cookie } })
    me.json?.user ? pass('会话', me.json.user.nickname) : fail('会话', me.text.slice(0, 100))

    const song = { platform: 'kw', songmid: '228908', name: '晴天', singer: '周杰伦', albumName: '叶惠美', interval: 269, qualities: ['320k'] }
    const favorite = await post('/api/library/favorites', { song }, { cookie })
    favorite.json?.library?.favorites?.length === 1 ? pass('收藏') : fail('收藏', favorite.text.slice(0, 120))

    const playlist = await post('/api/library/playlists', { name: '自检歌单' }, { cookie })
    const id = playlist.json?.library?.playlists?.[0]?.id
    id ? pass('歌单创建') : fail('歌单创建', playlist.text.slice(0, 120))

    if (id) {
      const added = await post('/api/library/playlists/' + id + '/songs', { song }, { cookie })
      added.json?.library?.playlists?.[0]?.songs?.length === 1 ? pass('歌单加歌') : fail('歌单加歌', added.text.slice(0, 120))
    }

    const history = await post('/api/library/history', { song }, { cookie })
    history.json?.library?.history?.length === 1 ? pass('播放记录') : fail('播放记录', history.text.slice(0, 60))

    const anon = await api('/api/library')
    anon.status === 401 ? pass('未登录拦截') : fail('未登录拦截', 'HTTP ' + anon.status)
  }

  const charts = await api('/api/charts')
  const boards = charts.json?.charts ?? []
  boards.length > 0 ? pass('排行榜', boards.length + ' 个') : fail('排行榜', '没有榜单')

  const discover = await api('/api/discover/playlists?limit=6')
  const feeds = discover.json?.playlists ?? []
  feeds.length > 0 ? pass('推荐歌单', feeds.length + ' 个') : fail('推荐歌单', discover.text.slice(0, 120))
  if (feeds[0]) {
    const detail = await api('/api/playlist/' + encodeURIComponent(feeds[0].id) + '?limit=5')
    detail.json?.songs?.length > 0
      ? pass('歌单详情', detail.json.songs.length + ' 首')
      : fail('歌单详情', detail.text.slice(0, 120))
  }

  const newSongs = await api('/api/discover/new-songs?limit=4')
  const fresh = newSongs.json?.songs ?? []
  fresh.length > 0 ? pass('新歌速递', fresh.length + ' 首') : fail('新歌速递', newSongs.text.slice(0, 120))

  const singers = await api('/api/discover/singers?limit=4')
  const stars = singers.json?.singers ?? []
  stars.length > 0 ? pass('热门歌手', stars.length + ' 位') : fail('热门歌手', singers.text.slice(0, 120))

  console.log('')
  for (const [state, name, extra] of results) {
    console.log(state.padEnd(5) + ' ' + name.padEnd(14) + ' ' + extra)
  }
  const failed = results.filter((item) => item[0] === 'FAIL').length
  console.log('')
  console.log(results.length + ' 项检查，' + failed + ' 项失败')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('自检失败：', err)
  process.exit(1)
})
