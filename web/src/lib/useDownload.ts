import { useCallback } from 'react'
import { api } from '../lib/api'
import { QUALITY_NAMES, type Song } from '../lib/types'
import { useAppConfig } from '../state/appConfig'
import { useAuth } from '../state/auth'
import { useAuthModal } from '../state/authModal'
import { useToast } from '../state/toast'

export function useDownload() {
  const auth = useAuth()
  const authModal = useAuthModal()
  const { downloadEnabled, allowedQualities, refresh } = useAppConfig()
  const toast = useToast()

  const canDownload = downloadEnabled

  const download = useCallback(
    async (song: Song) => {
      if (!downloadEnabled) {
        if (!auth.user) authModal.open('login', '当前游客下载权限受限，请登录')
        else toast.error('当前账号没有下载权限')
        return
      }
      toast.show('正在准备下载…')
      try {
        const result = await api.download(song)
        const anchor = document.createElement('a')
        anchor.href = result.url
        anchor.download = result.filename
        anchor.rel = 'noopener'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        toast.success('开始下载 · ' + QUALITY_NAMES[result.quality])
        void refresh()
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [auth.user, authModal, downloadEnabled, toast, refresh],
  )

  return { download, canDownload, downloadEnabled, allowedQualities }
}
