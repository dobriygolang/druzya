// Typed WebSocket events per channel.
// Channels are identified by a prefix + resource id, e.g. "arena/{matchId}".

export type ArenaEvents = {
  opponent_joined: { nick: string; tier: string }
  opponent_typing: { active: boolean }
  opponent_run: { tests: string }
  opponent_submit: { passed: boolean }
  match_result: { winner: 'me' | 'opponent'; score: string }
  time_warning: { secondsLeft: number }
}

export type SpectatorEvents = {
  code_update: { side: 'a' | 'b'; lines: string[]; highlight?: number }
  test_result: { side: 'a' | 'b'; passed: number; total: number }
  viewer_count: { count: number }
  chat_message: { nick: string; color: string; text: string }
}

export type MockEvents = {
  ai_message: { from: 'ai' | 'user'; text: string }
  ai_evaluation: {
    metrics: { label: string; value: number }[]
  }
  hint_unlocked: { text: string }
  time_warning: { secondsLeft: number }
}

export type WarRoomEvents = {
  log_event: { color: string; text: string; time: string }
  member_status: { name: string; progress: number; status: string }
  score_update: { errorRate: number; label: string }
}

// Map channel prefix => event map
export type ChannelEventMap = {
  arena: ArenaEvents
  spectator: SpectatorEvents
  mock: MockEvents
  warroom: WarRoomEvents
}

export type ChannelPrefix = keyof ChannelEventMap

// Generic event payload from any channel
export type AnyEvent =
  | { event: keyof ArenaEvents; payload: ArenaEvents[keyof ArenaEvents] }
  | { event: keyof SpectatorEvents; payload: SpectatorEvents[keyof SpectatorEvents] }
  | { event: keyof MockEvents; payload: MockEvents[keyof MockEvents] }
  | { event: keyof WarRoomEvents; payload: WarRoomEvents[keyof WarRoomEvents] }

export function channelPrefix(channel: string): ChannelPrefix | null {
  const p = channel.split('/')[0]
  if (p === 'arena' || p === 'spectator' || p === 'mock' || p === 'warroom') return p
  return null
}
