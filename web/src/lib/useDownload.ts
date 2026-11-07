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
  const { downloadEnabled, allowedQualities } = useAppConfig()
  const toast = useToast()

  const canDownload = !!auth.user && downloadEnabled

  const download = useCallback(
    async (song: Song) => {
      if (!auth.user) {
        authModal.open('login', '登录后才能下载歌曲')
        return
      }
      if (!downloadEnabled) {
        toast.error('管理员已关闭下载功能')
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
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [auth.user, authModal, downloadEnabled, toast],
  )

  return { download, canDownload, downloadEnabled, allowedQualities }
}
