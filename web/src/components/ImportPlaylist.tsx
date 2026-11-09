import { useState } from 'react'
import { api } from '../lib/api'
import type { PlaylistDetailResult } from '../lib/types'
import { useLibrary } from '../state/library'
import { useAuthModal } from '../state/authModal'
import { Modal } from './Modal'

export function ImportPlaylist({ id }: { id?: string }) {
  const library = useLibrary()
  const authModal = useAuthModal()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [preview, setPreview] = useState<PlaylistDetailResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    setBusy(true); setError(''); setPreview(null)
    try { setPreview(await api.previewPlaylist(id ? { id } : { link })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    <button className="btn btn--sm" onClick={() => {
      if (library.guest) { authModal.open('login', '登录后保存整张歌单'); return }
      setOpen(true); setError(''); setPreview(null); if (id) void load()
    }}>{id ? '保存为我的歌单' : '导入外链歌单'}</button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false) }} title={id ? '保存歌单副本' : '导入公开歌单'}>
      <div className="stack gap-16">
        {!id && <><label>QQ 音乐 / 网易云歌单分享链接<input className="input" disabled={busy} value={link} onChange={e => { setLink(e.target.value); setPreview(null) }} placeholder="粘贴分享链接" /></label>
          <button className="btn" disabled={busy || !link.trim()} onClick={() => void load()}>{busy ? '读取完整歌单…' : '预览歌单'}</button></>}
        {id && busy && <p className="dim">读取完整歌单…</p>}
        {error && <p role="alert">{error}</p>}
        {preview && <><p>{preview.playlist.name} · {preview.songs.length} 首</p><p className="dim">保存为独立副本，原歌单后续变更不会影响此副本</p>
          <button className="btn btn--primary" disabled={busy} onClick={async () => {
            setBusy(true); setError('')
            try { await library.importPlaylist({ name: preview.playlist.name, description: preview.playlist.description, songs: preview.songs }); setOpen(false) }
            catch (e) { setError((e as Error).message) }
            finally { setBusy(false) }
          }}>{busy ? '保存中…' : '保存到我的歌单'}</button></>}
        {id && error && <button className="btn" disabled={busy} onClick={() => void load()}>重新读取</button>}
      </div>
    </Modal>
  </>
}
