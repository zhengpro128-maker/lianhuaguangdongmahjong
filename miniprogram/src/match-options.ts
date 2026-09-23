export const MINI_MATCH_OPTIONS = [
  { value: 'rounds4', rounds: 4 },
  { value: 'rounds8', rounds: 8 },
  { value: 'rounds16', rounds: 16 },
] as const
export type MiniMatch = typeof MINI_MATCH_OPTIONS[number]['value']

/** Migrate the saved pre-redesign selections without exposing wind-based names. */
export function normalizeMiniMatch(value?: string): MiniMatch {
  if (value === 'hanchan' || value === 'rounds8') return 'rounds8'
  return value === 'rounds16' ? 'rounds16' : 'rounds4'
}
export function miniMatchRounds(value?: string) {
  return MINI_MATCH_OPTIONS.find(option => option.value === normalizeMiniMatch(value))!.rounds
}
