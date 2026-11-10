import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../lib/router'
import { useAuth } from '../state/auth'
import { useAuthModal } from '../state/authModal'
import { useAppConfig } from '../state/appConfig'
import { THEMES, useSettings } from '../state/settings'
import { useToast } from '../state/toast'
import { PLATFORM_NAMES, QUALITY_NAMES, ROLE_NAMES, type Quality } from '../lib/types'
import { initials } from '../lib/format'
import { AlertIcon, CheckIcon, CrownIcon, LogOutIcon, ShieldIcon, SlidersIcon, UserIcon } from '../components/Icons'

type Section = 'account' | 'playback' | 'appearance' | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'account', label: '账号' },
  { id: 'playback', label: '播放' },
  { id: 'appearance', label: '外观' },
  { id: 'about', label: '关于' },
]

const QUALITIES: Quality[] = ['flac24bit', 'flac', '320k', '128k']

export function SettingsPage({ section: initialSection = 'account' }: { section?: Section }) {
  const auth = useAuth()
  const authModal = useAuthModal()
  const appConfig = useAppConfig()
  const { settings, update } = useSettings()
  const toast = useToast()
  const [section, setSection] = useState<Section>(initialSection)

  const [nickname, setNickname] = useState(auth.user?.nickname ?? '')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const isAdmin = auth.user?.role === 'admin'

  const saveProfile = async () => {
    try {
      const result = await api.updateProfile({ nickname })
      auth.setUser(result.user)
      toast.success('资料已更新')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const changePassword = async () => {
    if (!oldPassword || !newPassword) return
    try {
      await api.changePassword({ oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      toast.success('密码已修改')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">账号、音源与播放偏好</p>
        </div>
      </div>

      {isAdmin ? (
        <div className="admin-entry glass" style={{ marginBottom: 18 }}>
          <div className="admin-entry__icon">
            <ShieldIcon size={19} />
          </div>
          <div className="grow">
            <div style={{ fontWeight: 500 }}>管理后台</div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              管理用户、音源与下载权限
            </div>
          </div>
          <button className="btn btn--sm btn--primary" onClick={() => window.location.assign('/admin/')}>
            进入后台
          </button>
        </div>
      ) : null}

      <div className="settings-grid">
        <div className="settings-nav">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? 'is-active' : ''}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div>
          {section === 'account' ? (
            <div className="card card--pad-lg">
              {auth.user ? (
                <>
                  <div className="row gap-16" style={{ marginBottom: 20 }}>
                    <div className="avatar" style={{ width: 54, height: 54, fontSize: 20, background: auth.user.avatarColor }}>
                      {initials(auth.user.nickname)}
                    </div>
                    <div className="grow">
                      <div style={{ fontSize: 17, fontWeight: 500 }}>{auth.user.nickname}</div>
                      <div className="dim" style={{ fontSize: 12.5 }}>
                        @{auth.user.username}
                        {auth.user.role !== 'user' ? (
                          <span className="tag tag--sq" style={{ marginLeft: 8 }}>
                            <CrownIcon size={10} /> {ROLE_NAMES[auth.user.role]}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button className="btn btn--sm btn--ghost" onClick={() => void auth.logout()}>
                      <LogOutIcon size={15} /> 退出登录
                    </button>
                  </div>

                  <div className="setting-row" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="grow">
                      <div className="setting-label">昵称</div>
                    </div>
                    <div className="row gap-8">
                      <input
                        className="input"
                        style={{ width: 180, height: 38 }}
                        value={nickname}
                        maxLength={24}
                        onChange={(event) => setNickname(event.target.value)}
                      />
                      <button className="btn btn--sm" onClick={() => void saveProfile()} disabled={!nickname.trim()}>
                        保存
                      </button>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="grow">
                      <div className="setting-label">修改密码</div>
                      <div className="setting-desc">修改后其他已登录设备仍会保持登录</div>
                    </div>
                    <div className="row gap-8" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <input
                        className="input"
                        type="password"
                        placeholder="原密码"
                        style={{ width: 130, height: 38 }}
                        value={oldPassword}
                        onChange={(event) => setOldPassword(event.target.value)}
                      />
                      <input
                        className="input"
                        type="password"
                        placeholder="新密码"
                        style={{ width: 130, height: 38 }}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                      <button
                        className="btn btn--sm"
                        onClick={() => void changePassword()}
                        disabled={!oldPassword || newPassword.length < 6}
                      >
                        修改
                      </button>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="grow">
                      <div className="setting-label">数据同步</div>
                      <div className="setting-desc">
                        收藏 {auth.user ? '、歌单与播放记录都保存在服务器' : '仅保存在本机'}
                      </div>
                    </div>
                    <span style={{ color: 'var(--success)' }}>
                      <CheckIcon size={18} />
                    </span>
                  </div>
                </>
              ) : (
                <div className="stack gap-16">
                  <div className="row gap-14">
                    <div className="avatar" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      <UserIcon size={16} />
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 500 }}>你正在使用访客模式</div>
                      <div className="dim" style={{ fontSize: 13 }}>
                        登录后收藏、歌单、播放记录会保存到服务器，多设备通用。
                      </div>
                    </div>
                  </div>
                  <div className="row gap-10">
                    <button className="btn btn--primary" onClick={() => authModal.open('login')}>
                      登录 / 注册
                    </button>
                  </div>
                </div>
              )}
              {appConfig.config?.access ? <div className="setting-row" style={{ marginTop: 16 }}>
                <div className="grow">
                  <div className="setting-label">下载额度</div>
                  <div className="setting-desc">
                    {appConfig.downloadEnabled ? <>
                      今日 {appConfig.config.access.usage.day.downloads} / {appConfig.config.access.dailyDownloads ?? '不限'} 次
                      {' · '}本月 {appConfig.config.access.usage.month.downloads} / {appConfig.config.access.monthlyDownloads ?? '不限'} 次
                      {appConfig.config.access.dailyBytes !== null || appConfig.config.access.monthlyBytes !== null ? <><br />
                        今日流量 {Math.ceil(appConfig.config.access.usage.day.bytes / 1024 ** 2)} / {appConfig.config.access.dailyBytes === null ? '不限' : Math.round(appConfig.config.access.dailyBytes / 1024 ** 2)} MB
                        {' · '}本月流量 {Math.ceil(appConfig.config.access.usage.month.bytes / 1024 ** 2)} / {appConfig.config.access.monthlyBytes === null ? '不限' : Math.round(appConfig.config.access.monthlyBytes / 1024 ** 2)} MB
                      </> : null}
                    </> : '当前身份未开放下载'}
                  </div>
                </div>
                <button className="btn btn--sm btn--ghost" onClick={() => void appConfig.refresh()}>刷新</button>
              </div> : null}
            </div>
          ) : null}


          {section === 'playback' ? (
            <div className="card card--pad-lg">
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>音质偏好</div>
              <div className="chip-row" style={{ marginBottom: 10 }}>
                {QUALITIES.map((quality) => (
                  <button
                    key={quality}
                    className={'chip' + (settings.quality[0] === quality ? ' is-active' : '')}
                    disabled={!appConfig.playbackQualities.includes(quality)}
                    onClick={() => {
                      const rest = settings.quality.filter((item) => item !== quality)
                      update({ quality: [quality, ...rest] })
                    }}
                  >
                    {QUALITY_NAMES[quality]}
                  </button>
                ))}
              </div>

              <div className="setting-row" style={{ marginTop: 8 }}>
                <div className="grow">
                  <div className="setting-label">显示歌词翻译</div>
                </div>
                <button
                  className={'switch' + (settings.showTranslation ? ' is-on' : '')}
                  onClick={() => update({ showTranslation: !settings.showTranslation })}
                  aria-label="显示歌词翻译"
                />
              </div>
            </div>
          ) : null}

          {section === 'appearance' ? (
            <div className="card card--pad-lg">
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>主题</div>
              <div className="theme-grid" style={{ maxWidth: 520 }}>
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    className={'theme-item' + (settings.theme === theme.id ? ' is-active' : '')}
                    onClick={() => update({ theme: theme.id })}
                  >
                    <span
                      className="theme-swatch"
                      style={{ background: theme.dots[0] }}
                    >
                      <span className="theme-swatch__dots">
                        <i style={{ background: theme.dots[1] }} />
                        <i style={{ background: theme.dots[2] }} />
                      </span>
                    </span>
                    <span className="theme-item__name">{theme.name}</span>
                    {settings.theme === theme.id ? <CheckIcon size={14} /> : null}
                  </button>
                ))}
              </div>

              <div className="setting-row" style={{ marginTop: 18 }}>
                <div className="grow">
                  <div className="setting-label">默认搜索平台</div>
                </div>
                <select
                  className="input"
                  style={{ width: 150, height: 38 }}
                  value={settings.defaultPlatform}
                  onChange={(event) => update({ defaultPlatform: event.target.value as never })}
                >
                  {Object.entries(PLATFORM_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {section === 'about' ? (
            <div className="card card--pad-lg">
              <div className="row gap-14" style={{ marginBottom: 16 }}>
                <div className="brand__mark" style={{ width: 46, height: 46 }}>
                  <SlidersIcon size={22} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 500 }}>觅音 MiYin</div>
                  <div className="dim" style={{ fontSize: 12.5 }}>版本 1.0.0 · Web 音乐播放器</div>
                </div>
              </div>
              <div className="setting-desc" style={{ maxWidth: 560, lineHeight: 1.8 }}>
                觅音是一个自托管的 Web 音乐播放器：歌曲搜索来自各音乐平台的公开接口，播放地址由「洛雪音乐」自定义音源脚本在服务端解析。
                支持注册登录，收藏与歌单保存在你自己的服务器上。
              </div>
              <div className="setting-row" style={{ marginTop: 12 }}>
                <div className="grow">
                  <div className="setting-label">音源来源</div>
                  <div className="setting-desc">github.com/pdone/lx-music-source</div>
                </div>
                <a className="btn btn--sm" href="https://github.com/pdone/lx-music-source" target="_blank" rel="noreferrer">
                  查看
                </a>
              </div>
              <div className="setting-row">
                <div className="grow">
                  <div className="setting-label">提示</div>
                  <div className="setting-desc">
                    音源脚本在服务端执行，请只启用你信任的来源。歌曲版权归各平台所有，请勿用于商业用途。
                  </div>
                </div>
                <AlertIcon size={18} style={{ color: 'var(--gold)' }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
