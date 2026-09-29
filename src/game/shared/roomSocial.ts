/** Stable IDs are shared by the mini-game UI and the room wire protocol. */
export const SOCIAL_PHRASES = [
  { id: 'hello', label: '大家好，很高兴一起打牌！' },
  { id: 'hurry', label: '轮到你啦，慢慢想～' },
  { id: 'nice', label: '这手牌打得漂亮！' },
  { id: 'luck', label: '祝大家好运！' },
  { id: 'thanks', label: '谢谢，合作愉快！' },
  { id: 'again', label: '再来一局吧！' },
] as const
export const SOCIAL_EMOJIS = [
  { id: 'smile', label: '开心', icon: '😄' }, { id: 'laugh', label: '大笑', icon: '😂' },
  { id: 'wow', label: '惊讶', icon: '😮' }, { id: 'cry', label: '哭哭', icon: '😭' },
  { id: 'like', label: '点赞', icon: '👍' }, { id: 'gg', label: '握手', icon: '🤝' },
] as const
export const SOCIAL_PROPS = [
  { id: 'tomato', label: '扔番茄', icon: '🍅', asset: '' },
  { id: 'coffee', label: '倒咖啡', icon: '☕', asset: '' },
  { id: 'hammer', label: '砸锤子', icon: '🔨', asset: '' },
] as const
export type SocialPayload = { category: 'text' | 'phrase' | 'emoji'; value: string }
  | { category: 'prop'; value: string; targetSeat: number }
export type SocialEvent = SocialPayload & { kind: 'room_social'; id: string; seat: number }
export type DisplaySocialEvent = SocialEvent & { receivedAt: number }
export const SOCIAL_COOLDOWN_MS = 2000
export const SOCIAL_TEXT_LIMIT = 60
const seat = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 4
export function validSocialPayload(raw: unknown): raw is SocialPayload {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  if (typeof p.value !== 'string') return false
  switch (p.category) {
    case 'text': return p.value.trim().length > 0 && Array.from(p.value).length <= SOCIAL_TEXT_LIMIT && !/[\u0000-\u001f\u007f]/.test(p.value)
    case 'phrase': return SOCIAL_PHRASES.some(item => item.id === p.value)
    case 'emoji': return SOCIAL_EMOJIS.some(item => item.id === p.value)
    case 'prop': return SOCIAL_PROPS.some(item => item.id === p.value) && seat(p.targetSeat)
    default: return false
  }
}
export function validSocialEvent(raw: unknown): raw is SocialEvent {
  if (!validSocialPayload(raw)) return false
  const event = raw as SocialEvent
  return event.kind === 'room_social' && typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 80
    && seat(event.seat) && (event.category !== 'prop' || event.targetSeat !== event.seat)
}
export function socialLabel(event: SocialPayload): string {
  if (event.category === 'text') return event.value
  if (event.category === 'phrase') return SOCIAL_PHRASES.find(item => item.id === event.value)?.label || ''
  if (event.category === 'emoji') { const item = SOCIAL_EMOJIS.find(item => item.id === event.value); return item ? `${item.icon} ${item.label}` : '' }
  return SOCIAL_PROPS.find(item => item.id === event.value)?.label || ''
}
