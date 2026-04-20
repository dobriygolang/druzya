import { authHandlers } from './auth'
import { profileHandlers } from './profile'
import { arenaHandlers } from './arena'
import { mockHandlers } from './mock'
import { dailyHandlers } from './daily'
import { ratingHandlers } from './rating'
import { guildHandlers } from './guild'
import { podcastHandlers } from './podcast'
import { seasonHandlers } from './season'
import { settingsHandlers } from './settings'
import { nativeHandlers } from './native'
import { slotHandlers } from './slot'

export const handlers = [
  ...authHandlers,
  ...profileHandlers,
  ...arenaHandlers,
  ...mockHandlers,
  ...dailyHandlers,
  ...ratingHandlers,
  ...guildHandlers,
  ...podcastHandlers,
  ...seasonHandlers,
  ...settingsHandlers,
  ...nativeHandlers,
  ...slotHandlers,
]
