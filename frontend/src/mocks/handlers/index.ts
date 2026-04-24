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
import { reviewHandlers } from './review'
import { achievementsHandlers } from './achievements'
import { notificationsHandlers } from './notifications'
import { friendsHandlers } from './friends'
import { helpHandlers } from './help'
import { heroCardsHandlers } from './herocards'
import { streakHandlers } from './streak'
import { weeklyHandlers } from './weekly'
import { matchesHandlers } from './matches'
import { tournamentHandlers } from './tournament'
import { dungeonsHandlers } from './dungeons'
import { calendarHandlers } from './calendar'
import { sysdesignHandlers } from './sysdesign'
import { autopsyHandlers } from './autopsy'
import { replayHandlers } from './replay'
import { voiceHandlers } from './voice'

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
  ...reviewHandlers,
  ...achievementsHandlers,
  ...notificationsHandlers,
  ...friendsHandlers,
  ...helpHandlers,
  ...heroCardsHandlers,
  ...streakHandlers,
  ...weeklyHandlers,
  ...matchesHandlers,
  ...tournamentHandlers,
  ...dungeonsHandlers,
  ...calendarHandlers,
  ...sysdesignHandlers,
  ...autopsyHandlers,
  ...replayHandlers,
  ...voiceHandlers,
]
