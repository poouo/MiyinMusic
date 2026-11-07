import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useDownload } from '../lib/useDownload'
import { formatDuration } from '../lib/format'
import { PLATFORM_NAMES, songKey } from '../lib/types'
import type { Quality, Song } from '../lib/types'
import { Cover } from './Cover'
import { DownloadIcon, HeartIcon, ListPlusIcon, PauseIcon, PlayIcon, TrashIcon } from './Icons'

export function QualityTag({ qualities }: { qualities?: Quality[] }) {
  const best = qualities?.[0]
  if (!best) return null
  if (best === 'flac24bit') return <span className="tag tag--sq">Hi-Res</span>
  if (best === 'flac') return <span className="tag tag--sq">SQ</span>
  if (best === '320k') return <span className="tag tag--hq">HQ</span>
  return null
}

interface SongListProps {
  songs: Song[]
  onPlay?: (index: number) => void
  onAddToPlaylist?: (song: Song) => void
  onRemove?: (song: Song) => void
  showAlbum?: boolean
  showIndex?: boolean
  showPlatform?: boolean
  currentKey?: string | null
  removeLabel?: string
}

export function SongList({
  songs,
  onPlay,
  onAddToPlaylist,
  onRemove,
  showAlbum = true,
  showIndex = true,
  showPlatform = false,
  currentKey,
  removeLabel = '从歌单移除',
}: SongListProps) {
  const player = usePlayer()
  const library = useLibrary()
  const { download, canDownload } = useDownload()

  return (
    <div className="list">
      {songs.map((song, index) => {
        const key = songKey(song)
        const isCurrent = currentKey ? currentKey === key : false
        const isPlaying = isCurrent && player.playing
        const favorite = library.isFavorite(song)
        return (
          <div
            key={key + '_' + index}
            className={'song-row' + (isCurrent ? ' is-current' : '')}
            onDoubleClick={() => (onPlay ? onPlay(index) : player.playSong(song, songs))}
          >
            {showIndex ? (
              <div className="song-row__index" onClick={() => (onPlay ? onPlay(index) : player.playSong(song, songs))}>
                {isCurrent ? (
                  isPlaying ? (
                    <PauseIcon size={15} />
                  ) : (
                    <PlayIcon size={15} />
                  )
                ) : (
                  <>
                    <span className="song-row__index-text">{index + 1}</span>
                    <span className="song-row__play" style={{ placeItems: 'center' }}>
                      <PlayIcon size={15} />
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div />
            )}

            <Cover song={song} className="song-row__cover" radius={9} />

            <div className="grow song-row__main" onClick={() => (onPlay ? onPlay(index) : player.playSong(song, songs))}>
              <div className="song-row__name ellipsis">
                {song.name}
                {showPlatform ? <span className="song-row__platform">{PLATFORM_NAMES[song.platform]}</span> : null}
              </div>
              <div className="song-row__singer song-row__singer--stack ellipsis">{song.singer || '未知歌手'}</div>
            </div>

            <div className="song-row__singer song-row__singer--col ellipsis">{song.singer || '未知歌手'}</div>

            {showAlbum ? <div className="song-row__album ellipsis">{song.albumName || '—'}</div> : <div />}

            <div className="song-row__quality" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <QualityTag qualities={song.qualities} />
            </div>

            <div className="song-row__time">{formatDuration(song.interval)}</div>

            <div className="song-row__actions">
              <button
                className={'icon-btn' + (favorite ? ' icon-btn--active' : '')}
                title={favorite ? '取消收藏' : '收藏'}
                onClick={() => void library.toggleFavorite(song)}
              >
                <HeartIcon size={16} filled={favorite} />
              </button>
              {onAddToPlaylist ? (
                <button className="icon-btn" title="添加到歌单" onClick={() => onAddToPlaylist(song)}>
                  <ListPlusIcon size={16} />
                </button>
              ) : null}
              {canDownload ? (
                <button className="icon-btn" title="下载" onClick={() => void download(song)}>
                  <DownloadIcon size={16} />
                </button>
              ) : null}
              {onRemove ? (
                <button className="icon-btn" title={removeLabel} onClick={() => onRemove(song)}>
                  <TrashIcon size={16} />
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}