
import { authHandlers } from './auth'
import { profileHandlers } from './profile'
import { mockHandlers } from './mock'
import { settingsHandlers } from './settings'
import { notificationsHandlers } from './notifications'
import { weeklyHandlers } from './weekly'
import { voiceHandlers } from './voice'
import { linguaHandlers } from './lingua'

export const handlers = [
  ...authHandlers,
  ...profileHandlers,
  ...mockHandlers,
  ...settingsHandlers,
  ...notificationsHandlers,
  ...weeklyHandlers,
  ...voiceHandlers,
  ...linguaHandlers,
]
