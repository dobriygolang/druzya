// Flat, type-safe dictionary. A missing key in any locale is a compile error,
// not a silent runtime fallback to the key string. Add new keys here and fill
// both ru.ts and en.ts in the same change.

export type Locale = 'ru' | 'en';

export interface Dict {
  'common.action.save': string;
  'common.action.cancel': string;
  'common.action.delete': string;
  'common.action.confirm': string;
  'common.action.dismiss': string;
  'common.action.retry': string;
  'common.action.close': string;
  'common.action.back': string;
  'common.action.next': string;
  'common.action.edit': string;
  'common.action.copy': string;
  'common.action.create': string;
  'common.action.send': string;
  'common.action.open': string;
  'common.action.apply': string;

  'common.status.loading': string;
  'common.status.saving': string;
  'common.status.saved': string;
  'common.status.deleting': string;
  'common.status.deleted': string;
  'common.status.syncing': string;
  'common.status.offline': string;
  'common.status.ready': string;
  'common.status.thinking': string;
  'common.status.empty': string;

  'common.error.generic': string;
  'common.error.network': string;
  'common.error.unauthorized': string;
  'common.error.not_found': string;

  'common.lang.title': string;
  'common.lang.hint': string;
  'common.lang.ru': string;
  'common.lang.en': string;

  // ── Hone: Auth / Login ───────────────────────────────────────────────
  'hone.auth.headline': string;
  'hone.auth.eyebrow': string;
  'hone.auth.body': string;
  'hone.auth.cta.sign_in': string;
  'hone.auth.cta.connecting': string;
  'hone.auth.cta.copy': string;
  'hone.auth.cta.copied': string;
  'hone.auth.cta.cancel': string;
  'hone.auth.code_label': string;
  'hone.auth.code_expired': string;
  'hone.auth.bot_open_again_pre': string;
  'hone.auth.bot_open_again_link': string;
  'hone.auth.bot_open_again_post': string;
  'hone.auth.waiting': string;
  'hone.auth.bot_timeout': string;
  'hone.auth.dev.eyebrow': string;
  'hone.auth.dev.username_placeholder': string;
  'hone.auth.dev.label': string;
  'hone.auth.dev.cta': string;
  'hone.auth.dev.busy': string;

  // ── Hone: Onboarding ─────────────────────────────────────────────────
  'hone.onboarding.step_label': string;
  'hone.onboarding.step1.title': string;
  'hone.onboarding.step2.title': string;
  'hone.onboarding.step3.title': string;
  'hone.onboarding.step4.title': string;
  'hone.onboarding.stack.hint': string;
  'hone.onboarding.mode.hint': string;
  'hone.onboarding.shortcuts.hint': string;
  'hone.onboarding.tier.hint': string;
  'hone.onboarding.tier.note': string;
  'hone.onboarding.btn.skip': string;
  'hone.onboarding.btn.back': string;
  'hone.onboarding.btn.next': string;
  'hone.onboarding.btn.stay_on_free': string;

  // ── Hone: Identity intro ─────────────────────────────────────────────
  'hone.identity.welcome': string;
  'hone.identity.title': string;
  'hone.identity.intro': string;
  'hone.identity.you_are_here': string;
  'hone.identity.tip': string;
  'hone.identity.btn.got_it': string;
  'hone.identity.hone.tagline_ru': string;
  'hone.identity.hone.tagline_en': string;
  'hone.identity.hone.feature.ai_plan': string;
  'hone.identity.hone.feature.notes': string;
  'hone.identity.hone.feature.taskboard': string;
  'hone.identity.hone.feature.english': string;
  'hone.identity.hone.feature.pomodoro': string;
  'hone.identity.web.tagline_ru': string;
  'hone.identity.web.tagline_en': string;
  'hone.identity.web.feature.mock': string;
  'hone.identity.web.feature.atlas': string;
  'hone.identity.web.feature.codex': string;
  'hone.identity.web.feature.coach': string;
  'hone.identity.web.feature.whiteboard': string;
  'hone.identity.web.cta': string;
  'hone.identity.cue.tagline_ru': string;
  'hone.identity.cue.tagline_en': string;
  'hone.identity.cue.feature.invisible': string;
  'hone.identity.cue.feature.transcript': string;
  'hone.identity.cue.feature.hints': string;
  'hone.identity.cue.feature.prep': string;
  'hone.identity.cue.cta': string;

  // ── Hone: Lingua migration modal ─────────────────────────────────────
  'hone.lingua.title': string;
  'hone.lingua.body': string;
  'hone.lingua.cta.open': string;
  'hone.lingua.cta.close': string;

  // ── Hone: Cue install suggestion ─────────────────────────────────────
  'hone.cue_install.eyebrow': string;
  'hone.cue_install.title': string;
  'hone.cue_install.body': string;
  'hone.cue_install.cta.dismiss': string;
  'hone.cue_install.cta.install': string;

  // ── Hone: Settings tabs / page ───────────────────────────────────────
  'hone.settings.heading': string;
  'hone.settings.search_placeholder': string;
  'hone.settings.tab.account': string;
  'hone.settings.tab.appearance': string;
  'hone.settings.tab.focus': string;
  'hone.settings.tab.memory': string;
  'hone.settings.tab.storage': string;
  'hone.settings.tab.devices': string;
  'hone.settings.tab.analytics': string;
  'hone.settings.tab.advanced': string;
  'hone.settings.search.zero_results': string;
  'hone.settings.search.results_count': string;
  'hone.settings.search.empty_help': string;

  // ── Hone: Settings — FocusModeSection ────────────────────────────────
  'hone.focus_mode.lead': string;
  'hone.focus_mode.note_macos_only': string;
  'hone.focus_mode.cta.test': string;
  'hone.focus_mode.cta.testing': string;
  'hone.focus_mode.ready': string;
  'hone.focus_mode.err.empty': string;
  'hone.focus_mode.err.no_bridge': string;
  'hone.focus_mode.err.run_failed': string;

  // ── Hone: Settings — QuickCaptureSection ─────────────────────────────
  'hone.quick_capture.lead_pre': string;
  'hone.quick_capture.lead_post': string;
  'hone.quick_capture.toggle_label': string;

  // ── Hone: Settings — DayShutdownSection ──────────────────────────────
  'hone.day_shutdown.lead': string;
  'hone.day_shutdown.note_desktop_only': string;
  'hone.day_shutdown.toggle_label': string;
  'hone.day_shutdown.time_label': string;

  // ── Hone: TaskBoard ──────────────────────────────────────────────────
  'hone.taskboard.tab.my': string;
  'hone.taskboard.tab.week': string;
  'hone.taskboard.btn.archive': string;
  'hone.taskboard.btn.archive_title': string;
  'hone.taskboard.empty.title': string;
  'hone.taskboard.empty.body': string;
  'hone.taskboard.empty.create_first': string;
  'hone.taskboard.empty.filter_title': string;
  'hone.taskboard.empty.filter_body': string;
  'hone.taskboard.empty.clear_filter': string;
  'hone.taskboard.create.title_placeholder': string;
  'hone.taskboard.create.body_placeholder': string;
  'hone.taskboard.create.priority_label': string;
  'hone.taskboard.create.show_more': string;
  'hone.taskboard.create.hide_more': string;
  'hone.taskboard.create.skill_placeholder': string;
  'hone.taskboard.create.kbd_hint': string;
  'hone.taskboard.create.cta.cancel': string;
  'hone.taskboard.create.cta.submit': string;
  'hone.taskboard.create.cta.submitting': string;
  'hone.taskboard.drawer.open_external': string;
  'hone.taskboard.drawer.comments_label': string;
  'hone.taskboard.drawer.no_comments': string;
  'hone.taskboard.drawer.add_comment_placeholder': string;
  'hone.taskboard.drawer.author_ai': string;
  'hone.taskboard.drawer.author_you': string;

  // ── Hone: Notification / toast strings ───────────────────────────────
  'hone.notify.task_created': string;
  'hone.notify.task_create_failed': string;
  'hone.notify.task_deleted': string;
  'hone.notify.override_failed': string;

  // ── Hone: TaskBoard — ContextMenu / ArchiveDrawer / Suggestions ──────
  'hone.taskboard.ctx.delete_confirm': string;
  'hone.taskboard.ctx.delete': string;
  'hone.taskboard.ctx.move_to': string;
  'hone.taskboard.archive.eyebrow': string;
  'hone.taskboard.archive.empty_title': string;
  'hone.taskboard.archive.empty_help': string;
  'hone.taskboard.archive.delete_confirm': string;
  'hone.taskboard.suggest.add_as_task': string;
  'hone.taskboard.suggest.dismiss': string;

  // ── Hone: ExternalActivityModal ──────────────────────────────────────
  'hone.external.title': string;
  'hone.external.field.source': string;
  'hone.external.field.topic': string;
  'hone.external.field.topic_placeholder': string;
  'hone.external.field.minutes': string;
  'hone.external.field.note': string;
  'hone.external.field.note_placeholder': string;
  'hone.external.err.topic_required': string;
  'hone.external.cta.save': string;
  'hone.external.cta.saving': string;

  // ── Hone: GoalEditModal ──────────────────────────────────────────────
  'hone.goal.field.company': string;
  'hone.goal.field.goal': string;
  'hone.goal.field.description': string;
  'hone.goal.field.deadline': string;

  // ── Hone: OfflineBanner ──────────────────────────────────────────────
  'hone.offline.banner_no_network': string;
  'hone.offline.banner_changes_pending': string;
  'hone.offline.banner_changes_count': string;
  'hone.offline.banner_server_unreachable': string;
  'hone.offline.banner_backend_slow': string;
  'hone.offline.banner_recovering': string;

  // ── Hone: DayShutdownModal ───────────────────────────────────────────
  'hone.day_shutdown.modal.label': string;
  'hone.day_shutdown.modal.title': string;
  'hone.day_shutdown.modal.later': string;
  'hone.day_shutdown.prompt.done': string;
  'hone.day_shutdown.prompt.pending': string;
  'hone.day_shutdown.prompt.tomorrow': string;
  'hone.day_shutdown.modal.err.empty': string;
  'hone.day_shutdown.modal.err.save_failed': string;
  'hone.day_shutdown.modal.eyebrow_updating': string;
  'hone.day_shutdown.modal.eyebrow_60s': string;
  'hone.day_shutdown.modal.cta.save': string;
  'hone.day_shutdown.modal.cta.update': string;
  'hone.day_shutdown.modal.cta.saving': string;

  // ── Hone: DataLoader fallback ────────────────────────────────────────
  'hone.data.err.load_failed': string;

  // ── Hone: AI Coach pill / Coach pages ────────────────────────────────
  'hone.coach.pill.label': string;
  'hone.coach.pill.close': string;
  'hone.coach.pill.err_connect': string;
  'hone.coach.pill.connecting': string;
  'hone.coach.pill.thinking': string;
  'hone.coach.pill.placeholder': string;
  'hone.coach.header.goal_prefix': string;
  'hone.coach.header.memory_format': string;
  'hone.coach.err.partial_load': string;

  // ── Hone: MemoryTimeline ─────────────────────────────────────────────
  'hone.memory.delete_confirm': string;
  'hone.memory.empty': string;
  'hone.memory.loading': string;
  'hone.memory.err.load': string;
  'hone.memory.delete_title': string;
  'hone.memory.footer_note': string;

  // ── Hone: TutorAssignments / pages ───────────────────────────────────
  'hone.tutor.err.load': string;
  'hone.tutor.empty': string;
  'hone.calendar.err.load': string;

  // ── Hone: Stats overlay / loading ────────────────────────────────────
  'hone.stats.loading': string;
  'hone.stats.title_insights': string;
  'hone.stats.title_memory': string;

  // ── Hone: CrossAppReminder ───────────────────────────────────────────
  'hone.coach.cross.open_atlas_title': string;
  'hone.coach.cross.open_insights_title': string;
}
