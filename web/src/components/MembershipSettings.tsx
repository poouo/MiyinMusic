import { useState } from 'react'
import { AUDIENCE_NAMES, QUALITY_NAMES, type AudiencePolicy, type MembershipConfig, type Quality } from '../lib/types'
import { CheckIcon } from './Icons'

const QUALITIES: Quality[] = ['128k', '320k', 'flac', 'flac24bit']
const ROLES = ['guest', 'user', 'vip'] as const

export function MembershipSettings({ value, onChange, saving, onSave }: {
  value: MembershipConfig
  onChange: (value: MembershipConfig) => void
  saving: boolean
  onSave: () => void
}) {
  const [role, setRole] = useState<typeof ROLES[number]>('guest')
  const policy = value.audiences[role]
  const change = (patch: Partial<AudiencePolicy>) => onChange({ ...value,
    audiences: { ...value.audiences, [role]: { ...policy, ...patch } } })
  const qualities = (field: 'playbackQualities' | 'downloadQualities') => (
    <div className="quality-grid">
      {QUALITIES.map(quality => {
        const checked = policy[field].includes(quality)
        return <button type="button" key={quality} aria-pressed={checked}
          className={'quality-card' + (checked ? ' is-on' : '')}
          onClick={() => change({ [field]: checked ? policy[field].filter(item => item !== quality) : [...policy[field], quality] })}>
          <span className="quality-card__check">{checked ? <CheckIcon size={14} /> : null}</span>
          <span className="quality-card__name">{QUALITY_NAMES[quality]}</span>
        </button>
      })}
    </div>
  )

  return <div className="stack gap-16">
    <div className="admin-card glass">
      <div className="admin-card__head">
        <div>
          <div className="admin-card__title">会员与权限限制</div>
          <div className="faint membership-note">关闭后，所有人可收听、下载全部音质，不限额度。</div>
        </div>
        <button className={'switch' + (value.enabled ? ' is-on' : '')} role="switch" aria-checked={value.enabled}
          aria-label="会员与权限限制" onClick={() => onChange({ ...value, enabled: !value.enabled })} />
      </div>
      <div className="membership-summary">{value.enabled ? '按身份设置权限 · 管理员不受限制' : '当前不限制收听与下载'}</div>
    </div>

    <fieldset className="membership-fields stack gap-16" disabled={!value.enabled}>
      <div className="membership-tabs" role="tablist" aria-label="权限身份">
        {ROLES.map(item => <button key={item} role="tab" aria-selected={item === role}
          className={'membership-tab' + (item === role ? ' is-active' : '')} onClick={() => setRole(item)}>{AUDIENCE_NAMES[item]}</button>)}
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head">
          <div className="admin-card__title">允许收听</div>
          <button className={'switch' + (policy.playbackEnabled ? ' is-on' : '')} role="switch"
            aria-checked={policy.playbackEnabled} aria-label={AUDIENCE_NAMES[role] + '允许收听'} onClick={() => change({ playbackEnabled: !policy.playbackEnabled })} />
        </div>
        <fieldset className="membership-fields" disabled={!policy.playbackEnabled}>
          <legend className="membership-label">收听音质</legend>{qualities('playbackQualities')}
        </fieldset>
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head">
          <div className="admin-card__title">允许下载</div>
          <button className={'switch' + (policy.downloadEnabled ? ' is-on' : '')} role="switch"
            aria-checked={policy.downloadEnabled} aria-label={AUDIENCE_NAMES[role] + '允许下载'} onClick={() => change({ downloadEnabled: !policy.downloadEnabled })} />
        </div>
        <fieldset className="membership-fields stack gap-16" disabled={!policy.downloadEnabled}>
          <legend className="membership-label">下载音质</legend>{qualities('downloadQualities')}
          <div className="membership-quota-grid">
            {([
              ['dailyDownloads', '每日下载次数', 1, '次'],
              ['monthlyDownloads', '每月下载次数', 1, '次'],
              ['dailyBytes', '每日下载流量', 1024 ** 2, 'MB'],
              ['monthlyBytes', '每月下载流量', 1024 ** 2, 'MB'],
            ] as const).map(([field, label, unit, suffix]) => <label key={field} className="membership-quota">
              <span>{label}</span>
              <span className="membership-quota__input">
                <input className="input" type="number" min={0} step={1} placeholder="不限"
                  aria-label={AUDIENCE_NAMES[role] + label} value={policy[field] === null ? '' : policy[field]! / unit}
                  onChange={event => change({ [field]: event.target.value === '' ? null : Math.max(0, Math.round(Number(event.target.value) * unit)) })} />
                <span>{suffix}</span>
              </span>
            </label>)}
          </div>
          <div className="faint membership-note">留空为不限，0 为无额度。每日与每月额度同时生效，按北京时间重置。</div>
        </fieldset>
      </div>
    </fieldset>

    {value.enabled && role === 'guest' ? <div className="membership-summary">游客按网络地址共享额度，更换浏览器或清除数据不会重置。</div> : null}
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <button className="btn btn--primary" onClick={onSave} disabled={saving}>{saving ? '保存中…' : '保存权限'}</button>
    </div>
  </div>
}
