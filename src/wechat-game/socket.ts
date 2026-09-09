import type { SocketLike } from '../game/online/transport/roomSocket'
import type { WxGameApi } from './wx'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

export function createWechatSocketFactory(
  wx: Pick<WxGameApi, 'connectSocket'>,
  getAccessToken?: () => string | null,
): (url: string) => SocketLike {
  return (url: string) => {
    const token = getAccessToken?.()
    const task = wx.connectSocket({
      url,
      ...(token ? { header: { Authorization: `Bearer ${token}` } } : {}),
    })

    const socket: SocketLike = {
      readyState: CONNECTING,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string) {
        if (socket.readyState !== OPEN) return
        task.send({ data, fail: (error) => socket.onerror?.(error) })
      },
      close() {
        if (socket.readyState === CLOSED) return
        task.close({ code: 1000, reason: 'client close' })
      },
    }

    task.onOpen(() => {
      socket.readyState = OPEN
      socket.onopen?.()
    })
    task.onMessage((event) => {
      if (typeof event.data === 'string') socket.onmessage?.({ data: event.data })
    })
    task.onError((error) => socket.onerror?.(error))
    task.onClose(() => {
      socket.readyState = CLOSED
      socket.onclose?.()
    })

    return socket
  }
}
