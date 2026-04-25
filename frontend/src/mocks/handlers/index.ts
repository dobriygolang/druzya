// Phase-4 ADR-001: removed orphan handlers — achievements, autopsy,
// calendar, cohort, native, season — alongside their backend services /
// frontend pages.

import { authHandlers } from './auth'
import { profileHandlers } from './profile'
import { arenaHandlers } from './arena'
import { mockHandlers } from './mock'
import { dailyHandlers } from './daily'
import { ratingHandlers } from './rating'
import { podcastHandlers } from './podcast'
import { settingsHandlers } from './settings'
import { slotHandlers } from './slot'
import { reviewHandlers } from './review'
import { notificationsHandlers } from './notifications'
import { friendsHandlers } from './friends'
import { helpHandlers } from './help'
import { streakHandlers } from './streak'
import { weeklyHandlers } from './weekly'
import { matchesHandlers } from './matches'
import { sysdesignHandlers } from './sysdesign'
import { replayHandlers } from './replay'
import { voiceHandlers } from './voice'

export const handlers = [
  ...authHandlers,
  ...profileHandlers,
  ...arenaHandlers,
  ...mockHandlers,
  ...dailyHandlers,
  ...ratingHandlers,
  ...podcastHandlers,
  ...settingsHandlers,
  ...slotHandlers,
  ...reviewHandlers,
  ...notificationsHandlers,
  ...friendsHandlers,
  ...helpHandlers,
  ...streakHandlers,
  ...weeklyHandlers,
  ...matchesHandlers,
  ...sysdesignHandlers,
  ...replayHandlers,
  ...voiceHandlers,
]
