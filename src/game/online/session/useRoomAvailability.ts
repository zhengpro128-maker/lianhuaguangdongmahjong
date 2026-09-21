import { onUnmounted, ref, watch, type Ref } from 'vue'
import type { GameMode } from '../../core/contracts/activeGamePort'
import { getJoinableRooms, getRoomMeta, type JoinableRoom, type RoomMeta } from '../api/roomApi'

export function useRoomAvailability(gameMode: Ref<GameMode>, roomId: Ref<string>) {
  const roomMeta = ref<RoomMeta | null>(null)
  const joinableRooms = ref<JoinableRoom[]>([])
  let pollingTimer: number | null = null

  async function refresh() {
    const [meta, rooms] = await Promise.allSettled([getRoomMeta(), getJoinableRooms()])
    if (meta.status === 'fulfilled') roomMeta.value = meta.value
    if (rooms.status === 'fulfilled') joinableRooms.value = rooms.value.rooms
    // 网络抖动时保留上一次数据，大厅不因辅助查询失败而报错。
  }

  function stopPolling() {
    if (pollingTimer == null) return
    window.clearInterval(pollingTimer)
    pollingTimer = null
  }

  watch([gameMode, roomId], ([mode, id]) => {
    if (mode === 'remote' && !id) {
      void refresh()
      if (pollingTimer == null) pollingTimer = window.setInterval(refresh, 5000)
    } else {
      stopPolling()
    }
  }, { immediate: true })

  onUnmounted(stopPolling)

  return { roomMeta, joinableRooms, refresh }
}
