import type { LyricResult, Platform, PlaylistInfo, SearchResult, SingerInfo, Song } from '../types.js'

export interface ChartInfo {
  id: string
  name: string
  platform: Platform
  cover?: string
}

export interface Provider {
  id: Platform
  /** 搜索歌曲 */
  search(keyword: string, page: number, limit: number): Promise<SearchResult>
  /** 获取歌词 */
  lyric(song: Song): Promise<LyricResult>
  /** 获取封面（搜索结果未提供封面时使用） */
  pic?(song: Song): Promise<string | null>
  /** 排行榜列表 */
  charts?(): Promise<ChartInfo[]>
  /** 排行榜歌曲 */
  chartSongs?(chartId: string, page: number, limit: number): Promise<SearchResult>
  /** 推荐歌单 / 歌单广场 */
  playlists?(page: number, limit: number): Promise<PlaylistInfo[]>
  /** 歌单详情，歌曲一次给全，由上层分页 */
  playlistSongs?(playlistId: string): Promise<{ playlist: PlaylistInfo; songs: Song[] }>
  /** 新歌速递 */
  newSongs?(limit: number): Promise<Song[]>
  /** 热门歌手 */
  singers?(limit: number): Promise<SingerInfo[]>
}
