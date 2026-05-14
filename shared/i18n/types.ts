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
  'hone.stats.external.empty': string;

  // ── Hone: CrossAppReminder ───────────────────────────────────────────
  'hone.coach.cross.open_atlas_title': string;
  'hone.coach.cross.open_insights_title': string;

  // ── Hone: Notes ──────────────────────────────────────────────────────
  'hone.notes.toast.promote_failed': string;
  'hone.notes.toast.move_failed': string;

  // ── Hone: Quick Capture window ───────────────────────────────────────
  'hone.quick_capture.status.saving': string;
  'hone.quick_capture.status.save_failed': string;
  'hone.quick_capture.status.err_prefix': string;

  // ── Hone: Palette ────────────────────────────────────────────────────
  'hone.palette.day_shutdown': string;

  // ── Hone: CueMeetingNotes / share ────────────────────────────────────
  'hone.cue_meet.not_synced': string;
  'hone.cue_meet.sent_to_tg': string;
  'hone.cue_meet.tg_not_connected': string;
  'hone.cue_meet.err_prefix': string;
  'hone.cue_meet.copy_failed': string;
  'hone.cue_meet.send_tg_title': string;
  'hone.cue_meet.share_title': string;
  'hone.cue_meet.open_in_cue_title': string;
  'hone.cue_meet.sending_tg': string;

  // ── Hone: ResistanceModal ────────────────────────────────────────────
  'hone.resistance.placeholder': string;
  'hone.resistance.cta.save_and_start': string;

  // ── Hone: ErrorBoundary ──────────────────────────────────────────────
  'hone.error.fell': string;
  'hone.error.unknown_section': string;
  'hone.error.unknown': string;

  // ── Hone: ExternalSource labels (api/external) ───────────────────────
  'hone.external.source.book': string;
  'hone.external.source.article': string;
  'hone.external.source.course': string;
  'hone.external.source.other': string;

  // ── Hone: Settings — EnergyNudgeSection ──────────────────────────────
  'hone.energy_nudge.lead': string;
  'hone.energy_nudge.note_desktop_only': string;
  'hone.energy_nudge.toggle_label': string;
  'hone.energy_nudge.interval_label': string;
  'hone.energy_nudge.hour.one': string;
  'hone.energy_nudge.hour.few': string;
  'hone.energy_nudge.hour.many': string;
  'hone.energy_nudge.settings_hint': string;

  // ── Hone: TaskBoard plural (helpers.ts) ──────────────────────────────
  'hone.taskboard.plural.task.one': string;
  'hone.taskboard.plural.task.few': string;
  'hone.taskboard.plural.task.many': string;

  // ── Hone: Coach header memory label plural ───────────────────────────
  'hone.coach.header.memory_label.short': string;
  'hone.coach.header.memory_label.long': string;

  // ── Hone: GoalEditModal / ExternalActivityModal hints ────────────────
  'hone.goal.full_wizard_hint': string;
  'hone.external.atlas_pinned_hint': string;

  // ── Hone: CueMeetingNotes Summary tab ────────────────────────────────
  'hone.cue_meet.summary.coming_soon_pre': string;
  'hone.cue_meet.summary.coming_soon_post': string;
  'hone.cue_meet.summary.tab_transcript': string;
  'hone.cue_meet.summary.coming_soon_title': string;
  'hone.cue_meet.summary.coming_soon_body': string;
  'hone.cue_meet.transcript.empty': string;

  // ── Hone: ResistanceModal heading ────────────────────────────────────
  'hone.resistance.headline': string;

  // ── Hone: AICoachPill empty hint ─────────────────────────────────────
  'hone.coach.pill.empty_hint': string;

  // ── Hone: MemoryTimeline footer guidance ─────────────────────────────
  'hone.memory.footer_outro': string;

  // ── Hone: TutorAssignments empty / heading ───────────────────────────
  'hone.tutor.intro': string;
  'hone.tutor.intro_pre': string;
  'hone.tutor.intro_post': string;
  'hone.tutor.empty_followup': string;

  // ── Hone: Today / Goal stub ──────────────────────────────────────────
  'hone.today.goal_stub_pre': string;
  'hone.today.goal_stub_link': string;
  'hone.today.goal_stub_post': string;

  // ── Hone: Calendar empty ─────────────────────────────────────────────
  'hone.calendar.empty.title': string;
  'hone.calendar.empty.body': string;

  // ── mock.common (shared между mock-pages) ────────────────────────────
  'mock.common.error.load_failed': string;
  'mock.common.error.start_failed': string;
  'mock.common.error.retry': string;
  'mock.common.error.new_session': string;
  'mock.common.section.brief': string;
  'mock.common.section.interviewer': string;
  'mock.common.section.dialog': string;
  'mock.common.section.stress': string;
  'mock.common.section.transcript': string;
  'mock.common.verdict.pass': string;
  'mock.common.verdict.fail': string;
  'mock.common.verdict.borderline': string;
  'mock.common.label.task': string;
  'mock.common.label.feedback': string;
  'mock.common.label.missing_points': string;
  'mock.common.label.your_answer': string;
  'mock.common.stage.hr.title': string;
  'mock.common.stage.algo.title': string;
  'mock.common.stage.coding.title': string;
  'mock.common.stage.sysdesign.title': string;
  'mock.common.stage.behavioral.title': string;
  'mock.common.stage.hr.hint': string;
  'mock.common.stage.algo.hint': string;
  'mock.common.stage.coding.hint': string;
  'mock.common.stage.sysdesign.hint': string;
  'mock.common.stage.behavioral.hint': string;

  // ── mock.session (MockSessionPage) ───────────────────────────────────
  'mock.session.live.label': string;
  'mock.session.hint': string;
  'mock.session.finishing': string;
  'mock.session.finish': string;
  'mock.session.listening': string;
  'mock.session.question_label': string;
  'mock.session.techlead.label': string;
  'mock.session.techlead.title': string;
  'mock.session.techlead.body': string;
  'mock.session.techlead.rubric.structure': string;
  'mock.session.techlead.rubric.ownership': string;
  'mock.session.techlead.rubric.impact': string;
  'mock.session.techlead.rubric.learning': string;
  'mock.session.senior_sd.label': string;
  'mock.session.senior_sd.title': string;
  'mock.session.senior_sd.body': string;
  'mock.session.senior_sd.rubric.depth': string;
  'mock.session.senior_sd.rubric.tradeoffs': string;
  'mock.session.senior_sd.rubric.failure_modes': string;
  'mock.session.senior_sd.rubric.pragmatism': string;
  'mock.session.sysanalyst.label': string;
  'mock.session.sysanalyst.title': string;
  'mock.session.sysanalyst.body': string;
  'mock.session.sysanalyst.rubric.requirements': string;
  'mock.session.sysanalyst.rubric.modeling': string;
  'mock.session.sysanalyst.rubric.integration': string;
  'mock.session.sysanalyst.rubric.data': string;
  'mock.session.sysanalyst.rubric.process': string;
  'mock.session.product_analyst.label': string;
  'mock.session.product_analyst.title': string;
  'mock.session.product_analyst.body': string;
  'mock.session.product_analyst.rubric.metrics': string;
  'mock.session.product_analyst.rubric.sql': string;
  'mock.session.product_analyst.rubric.experimentation': string;
  'mock.session.product_analyst.rubric.frameworks': string;
  'mock.session.product_analyst.rubric.communication': string;
  'mock.session.qa.label': string;
  'mock.session.qa.title': string;
  'mock.session.qa.body': string;
  'mock.session.qa.rubric.test_design': string;
  'mock.session.qa.rubric.api': string;
  'mock.session.qa.rubric.automation': string;
  'mock.session.qa.rubric.bug_analysis': string;
  'mock.session.qa.rubric.process': string;
  'mock.session.devops.label': string;
  'mock.session.devops.title': string;
  'mock.session.devops.body': string;
  'mock.session.devops.rubric.infra': string;
  'mock.session.devops.rubric.observability': string;
  'mock.session.devops.rubric.cicd': string;
  'mock.session.devops.rubric.incident': string;
  'mock.session.devops.rubric.security': string;
  'mock.session.english_hr.label': string;
  'mock.session.english_hr.title': string;
  'mock.session.english_hr.body': string;
  'mock.session.english_hr.rubric.clarity': string;
  'mock.session.english_hr.rubric.accuracy': string;
  'mock.session.english_hr.rubric.range': string;
  'mock.session.english_hr.rubric.fluency': string;
  'mock.session.stress.title': string;
  'mock.session.stress.pauses': string;
  'mock.session.stress.backspaces': string;
  'mock.session.stress.chaos': string;
  'mock.session.stress.paste_attempts': string;
  'mock.session.transcript.empty_hint': string;
  'mock.session.transcript.typing': string;
  'mock.session.transcript.you_prefix': string;
  'mock.session.message.placeholder': string;
  'mock.session.message.send': string;
  'mock.session.message.sending': string;
  'mock.session.editor.title': string;
  'mock.session.editor.placeholder': string;
  'mock.session.task.loading.title': string;
  'mock.session.task.loading.description': string;
  'mock.session.task.default_title': string;
  'mock.session.task.wait_ai': string;

  // ── mock.pipeline (MockPipelinePage) ─────────────────────────────────
  'mock.pipeline.coming_soon.title': string;
  'mock.pipeline.coming_soon.body': string;
  'mock.pipeline.coming_soon.cta': string;
  'mock.pipeline.err.load_title': string;
  'mock.pipeline.err.retry': string;
  'mock.pipeline.err.new': string;
  'mock.pipeline.err.not_found': string;
  'mock.pipeline.err.stage_not_found': string;
  'mock.pipeline.err.stage_inconsistent': string;
  'mock.pipeline.label': string;
  'mock.pipeline.company.random': string;
  'mock.pipeline.stages.label': string;
  'mock.pipeline.stages.progress_aria': string;
  'mock.pipeline.cancel_btn': string;
  'mock.pipeline.stage.loading': string;
  'mock.pipeline.stage.no_task_title': string;
  'mock.pipeline.stage.no_task_body': string;
  'mock.pipeline.stage.start_error_title': string;
  'mock.pipeline.chat.no_attempts_code': string;
  'mock.pipeline.chat.no_attempts_text': string;
  'mock.pipeline.chat.wait_judging': string;
  'mock.pipeline.chat.finish_stage': string;
  'mock.pipeline.task.complexity_target': string;
  'mock.pipeline.task.label': string;
  'mock.pipeline.answer.placeholder': string;
  'mock.pipeline.answer.kb_hint': string;
  'mock.pipeline.answer.chars': string;
  'mock.pipeline.answer.send': string;
  'mock.pipeline.code.kb_hint': string;
  'mock.pipeline.code.stats': string;
  'mock.pipeline.code.submit': string;
  'mock.pipeline.coming_soon.attempt_canvas': string;
  'mock.pipeline.coming_soon.attempt_voice': string;
  'mock.pipeline.coming_soon.attempt_phase': string;
  'mock.pipeline.coming_soon.attempt_soon': string;
  'mock.pipeline.verdict.water': string;
  'mock.pipeline.stage.soon_title': string;
  'mock.pipeline.stage.soon_body': string;
  'mock.pipeline.stage.skip': string;
  'mock.pipeline.ai.judging': string;

  // ── mock.sysdesign (SysDesignCanvas) ─────────────────────────────────
  'mock.sysdesign.brief_label': string;
  'mock.sysdesign.brief.default_title': string;
  'mock.sysdesign.functional_reqs': string;
  'mock.sysdesign.autosave.disabled': string;
  'mock.sysdesign.autosave.local_full': string;
  'mock.sysdesign.autosave.normal': string;
  'mock.sysdesign.fullscreen_open': string;
  'mock.sysdesign.open_fullscreen': string;
  'mock.sysdesign.restored.just_now': string;
  'mock.sysdesign.restored.min_ago': string;
  'mock.sysdesign.restored.h_ago': string;
  'mock.sysdesign.restored.prefix': string;
  'mock.sysdesign.restored.hide': string;
  'mock.sysdesign.fullscreen.hint_pre': string;
  'mock.sysdesign.fullscreen.hint_action': string;
  'mock.sysdesign.fullscreen.hint_post': string;
  'mock.sysdesign.loading_canvas': string;
  'mock.sysdesign.loading_diagram': string;
  'mock.sysdesign.submitted_label': string;
  'mock.sysdesign.diagram_missing': string;
  'mock.sysdesign.export_hint': string;
  'mock.sysdesign.field.non_functional': string;
  'mock.sysdesign.field.non_functional_submitted': string;
  'mock.sysdesign.field.context': string;
  'mock.sysdesign.field.context_submitted': string;
  'mock.sysdesign.field.non_functional_ph': string;
  'mock.sysdesign.field.context_ph': string;
  'mock.sysdesign.err.canvas_not_ready': string;
  'mock.sysdesign.err.empty_canvas': string;
  'mock.sysdesign.err.too_big': string;
  'mock.sysdesign.submit_button': string;
  'mock.sysdesign.ai_judging': string;

  // ── mock.picker (MockCompanyPicker) ──────────────────────────────────
  'mock.picker.title': string;
  'mock.picker.body': string;
  'mock.picker.atlas_focus.label': string;
  'mock.picker.atlas_focus.topic': string;
  'mock.picker.atlas_focus.body': string;
  'mock.picker.sections.legend': string;
  'mock.picker.sections.help': string;
  'mock.picker.sections.aria': string;
  'mock.picker.section.hr.label': string;
  'mock.picker.section.hr.hint': string;
  'mock.picker.section.algo.label': string;
  'mock.picker.section.algo.hint': string;
  'mock.picker.section.coding.label': string;
  'mock.picker.section.coding.hint': string;
  'mock.picker.section.sysdesign.label': string;
  'mock.picker.section.sysdesign.hint': string;
  'mock.picker.section.behavioral.label': string;
  'mock.picker.section.behavioral.hint': string;
  'mock.picker.ai_assist.legend': string;
  'mock.picker.ai_assist.aria': string;
  'mock.picker.ai_assist.off.title': string;
  'mock.picker.ai_assist.off.body': string;
  'mock.picker.ai_assist.on.title': string;
  'mock.picker.ai_assist.on.body': string;
  'mock.picker.track_filter.label': string;
  'mock.picker.track_filter.aria': string;
  'mock.picker.coming_soon.title': string;
  'mock.picker.coming_soon.body': string;
  'mock.picker.coming_soon.cta': string;
  'mock.picker.err.load_title': string;
  'mock.picker.err.load_body': string;
  'mock.picker.err.empty_title': string;
  'mock.picker.err.empty_body': string;
  'mock.picker.err.no_track': string;
  'mock.picker.err.create_pipeline_prefix': string;
  'mock.picker.first_run.header': string;
  'mock.picker.first_run.step1.body': string;
  'mock.picker.first_run.step2.body': string;
  'mock.picker.first_run.step3.body': string;

  // ── mock.diagnostic (DiagnosticPage) ─────────────────────────────────
  'mock.diagnostic.stepper.result': string;
  'mock.diagnostic.intro.title': string;
  'mock.diagnostic.intro.body': string;
  'mock.diagnostic.intro.pick_track': string;
  'mock.diagnostic.intro.disclaimer': string;
  'mock.diagnostic.track.go': string;
  'mock.diagnostic.track.ml': string;
  'mock.diagnostic.track.english': string;
  'mock.diagnostic.algo.eyebrow_format': string;
  'mock.diagnostic.algo.correct': string;
  'mock.diagnostic.algo.expected_prefix': string;
  'mock.diagnostic.cancel': string;
  'mock.diagnostic.answer': string;
  'mock.diagnostic.next_sysdesign': string;
  'mock.diagnostic.sysdesign.eyebrow': string;
  'mock.diagnostic.sysdesign.placeholder': string;
  'mock.diagnostic.sysdesign.short_warn': string;
  'mock.diagnostic.finish': string;
  'mock.diagnostic.result.title': string;
  'mock.diagnostic.result.algo': string;
  'mock.diagnostic.result.algo_correct': string;
  'mock.diagnostic.result.algo_wrong': string;
  'mock.diagnostic.result.sysdesign': string;
  'mock.diagnostic.result.coverage': string;
  'mock.diagnostic.result.covered': string;
  'mock.diagnostic.result.readiness': string;
  'mock.diagnostic.result.cta_today': string;
  'mock.diagnostic.factor.strong': string;
  'mock.diagnostic.factor.ok': string;
  'mock.diagnostic.factor.gaps': string;
  'mock.diagnostic.factor.critical': string;
  'mock.diagnostic.plural.word.one': string;
  'mock.diagnostic.plural.word.few': string;
  'mock.diagnostic.plural.word.many': string;

  // ── mock.result (MockResultPage) ─────────────────────────────────────
  'mock.result.export_pdf': string;
  'mock.result.listen': string;
  'mock.result.listen.premium_title': string;
  'mock.result.listen.normal_title': string;
  'mock.result.header.title': string;
  'mock.result.hero.eyebrow': string;
  'mock.result.hero.overall_format': string;
  'mock.result.hero.readiness_format': string;
  'mock.result.hero.verdict_label': string;
  'mock.result.strengths.title': string;
  'mock.result.weaknesses.title': string;
  'mock.result.recs.title': string;
  'mock.result.stress.title': string;
  'mock.result.stress.peak_format': string;
  'mock.result.companies.title': string;
  'mock.result.apply.title': string;
  'mock.result.apply.body': string;
  'mock.result.apply.cta': string;
  'mock.result.processing': string;
  'mock.result.modal.title': string;
  'mock.result.modal.description': string;
  'mock.result.modal.body': string;
  'mock.result.modal.dismiss': string;
  'mock.result.modal.subscribe': string;
  'mock.result.coach.label': string;
  'mock.result.coach.context_format': string;
  'mock.result.coach.name.go': string;
  'mock.result.coach.name.ml': string;
  'mock.result.coach.name.english': string;
  'mock.result.coach.name.sysdesign': string;
  'mock.result.coach.name.algo': string;
  'mock.result.stress_analysis.title': string;
  'mock.result.handoff.eyebrow': string;
  'mock.result.handoff.reflect': string;
  'mock.result.handoff.practice': string;
  'mock.result.tts.summary_prefix': string;

  // ── aitutor (AITutorChatPage) ────────────────────────────────────────
  'aitutor.err.persona_not_found': string;
  'aitutor.err.cant_open_chat': string;
  'aitutor.err.send_failed': string;
  'aitutor.atlas_link': string;
  'aitutor.daily_msg_today': string;
  'aitutor.coach.label': string;
  'aitutor.coach.learning': string;
  'aitutor.coach.knows_count_short': string;
  'aitutor.coach.knows_count_long': string;
  'aitutor.coach.events_30d': string;
  'aitutor.compose.placeholder': string;
  'aitutor.compose.thinking': string;
  'aitutor.section.history': string;
  'aitutor.memory.title': string;
  'aitutor.memory.events_count': string;
  'aitutor.memory.goal_label': string;
  'aitutor.memory.goal_empty': string;
  'aitutor.memory.goal.change': string;
  'aitutor.memory.goal.set': string;
  'aitutor.memory.readiness_label': string;
  'aitutor.memory.streak_label': string;
  'aitutor.memory.deadline_today': string;
  'aitutor.memory.days_to_target': string;
  'aitutor.memory.streak_max_format': string;
  'aitutor.memory.cue_label': string;
  'aitutor.memory.summary.loading': string;
  'aitutor.memory.summary.has_memory_no_summary': string;
  'aitutor.memory.summary.empty': string;
  'aitutor.section.coach_memory': string;
  'aitutor.time.minutes_ago': string;
  'aitutor.time.hours_ago': string;
  'aitutor.time.days_ago': string;
  'aitutor.plural.stage.one': string;
  'aitutor.plural.stage.few': string;
  'aitutor.plural.stage.many': string;
  'aitutor.plural.day.one': string;
  'aitutor.plural.day.few': string;
  'aitutor.plural.day.many': string;

  // ── Cue: Settings — Sidebar / tabs ───────────────────────────────────
  'cue.settings.tab.general': string;
  'cue.settings.tab.hotkeys': string;
  'cue.settings.tab.providers': string;
  'cue.settings.tab.documents': string;
  'cue.settings.tab.appearance': string;
  'cue.settings.tab.permissions': string;
  'cue.settings.tab.about': string;

  // ── Cue: Settings — General tab ──────────────────────────────────────
  'cue.settings.general.section.title': string;
  'cue.settings.general.section.subtitle': string;
  'cue.settings.general.account.title': string;
  'cue.settings.general.account.signed_out_title': string;
  'cue.settings.general.account.signed_out_hint': string;
  'cue.settings.general.account.cta.sign_out': string;
  'cue.settings.general.account.cta.sign_in': string;
  'cue.settings.general.prep.title': string;
  'cue.settings.general.prep.hint_default': string;
  'cue.settings.general.prep.hint_active_prefix': string;
  'cue.settings.general.prep.hint_active_since': string;
  'cue.settings.general.prep.cta.open': string;
  'cue.settings.general.prep.cta.start': string;
  'cue.settings.general.prep.cta.end': string;
  'cue.settings.general.transcription.title': string;
  'cue.settings.general.transcription.hint': string;
  'cue.settings.general.transcription.label.ru': string;
  'cue.settings.general.transcription.label.en_us': string;
  'cue.settings.general.transcription.label.en_gb': string;
  'cue.settings.general.transcription.label.auto': string;
  'cue.settings.general.subscription.refresh_title': string;
  'cue.settings.general.subscription.manage_boosty': string;
  'cue.settings.general.subscription.upgrade': string;
  'cue.settings.general.subscription.requests_unlimited': string;
  'cue.settings.general.subscription.requests_used': string;
  'cue.settings.general.subscription.reset_prefix': string;
  'cue.settings.general.subscription.paid_already': string;
  'cue.settings.general.subscription.loading': string;
  'cue.settings.general.subscription.plan_active_title': string;
  'cue.settings.general.history.title': string;
  'cue.settings.general.history.hint': string;
  'cue.settings.general.history.option_day_one': string;
  'cue.settings.general.history.option_day_seven': string;
  'cue.settings.general.history.option_day_thirty': string;
  'cue.settings.general.history.option_day_ninety': string;
  'cue.settings.general.history.option_year_one': string;
  'cue.settings.general.stealth.title': string;
  'cue.settings.general.stealth.hint_on': string;
  'cue.settings.general.stealth.hint_off': string;
  'cue.settings.general.analytics.title': string;
  'cue.settings.general.analytics.hint': string;
  'cue.settings.general.locale.title': string;
  'cue.settings.general.locale.hint': string;
  'cue.settings.general.locale.ru': string;
  'cue.settings.general.locale.en': string;
  'cue.settings.general.masquerade.title': string;
  'cue.settings.general.masquerade.hint': string;

  // ── Cue: Settings — Hotkeys tab ──────────────────────────────────────
  'cue.settings.hotkeys.section.title': string;
  'cue.settings.hotkeys.section.subtitle': string;
  'cue.settings.hotkeys.action.screenshot_area': string;
  'cue.settings.hotkeys.action.screenshot_full': string;
  'cue.settings.hotkeys.action.voice_input': string;
  'cue.settings.hotkeys.action.toggle_window': string;
  'cue.settings.hotkeys.action.quick_prompt': string;
  'cue.settings.hotkeys.action.instant_assist': string;
  'cue.settings.hotkeys.action.clear_conversation': string;
  'cue.settings.hotkeys.action.cursor_freeze_toggle': string;
  'cue.settings.hotkeys.action.move_window_left': string;
  'cue.settings.hotkeys.action.move_window_right': string;
  'cue.settings.hotkeys.action.move_window_up': string;
  'cue.settings.hotkeys.action.move_window_down': string;
  'cue.settings.hotkeys.action.english_polish': string;
  'cue.settings.hotkeys.recording_hint': string;
  'cue.settings.hotkeys.click_to_record': string;
  'cue.settings.hotkeys.reset': string;

  // ── Cue: Settings — Providers tab ────────────────────────────────────
  'cue.settings.providers.section.title': string;
  'cue.settings.providers.section.subtitle': string;
  'cue.settings.providers.catalog_label': string;
  'cue.settings.providers.empty': string;
  'cue.settings.providers.available': string;
  'cue.settings.providers.pro': string;
  'cue.settings.providers.latency_ms': string;

  // ── Cue: Settings — Documents tab ────────────────────────────────────
  'cue.settings.documents.section.title': string;
  'cue.settings.documents.section.subtitle': string;
  'cue.settings.documents.empty_session_subtitle': string;
  'cue.settings.documents.empty_session_body': string;
  'cue.settings.documents.upload_body': string;
  'cue.settings.documents.upload_hint': string;
  'cue.settings.documents.uploading': string;
  'cue.settings.documents.url_placeholder': string;
  'cue.settings.documents.url_cta': string;
  'cue.settings.documents.size_limit_error': string;
  'cue.settings.documents.loading': string;
  'cue.settings.documents.empty_list': string;
  'cue.settings.documents.has_session_hint': string;
  'cue.settings.documents.no_session_hint': string;
  'cue.settings.documents.chunks.one': string;
  'cue.settings.documents.chunks.few': string;
  'cue.settings.documents.chunks.many': string;
  'cue.settings.documents.attached': string;
  'cue.settings.documents.attach': string;
  'cue.settings.documents.delete_title': string;
  'cue.settings.documents.status.indexing': string;
  'cue.settings.documents.status.ready': string;
  'cue.settings.documents.status.failed': string;
  'cue.settings.documents.status.deleting': string;
  'cue.settings.documents.status.error_inline': string;
  'cue.settings.documents.err.generic': string;

  // ── Cue: Settings — Appearance tab ───────────────────────────────────
  'cue.settings.appearance.section.title': string;
  'cue.settings.appearance.section.subtitle': string;
  'cue.settings.appearance.opacity.title': string;
  'cue.settings.appearance.opacity.hint': string;
  'cue.settings.appearance.presets.title': string;
  'cue.settings.appearance.presets.hint': string;
  'cue.settings.appearance.window_size.title': string;
  'cue.settings.appearance.window_size.hint': string;
  'cue.settings.appearance.window_size.auto': string;

  // ── Cue: Settings — Permissions tab ──────────────────────────────────
  'cue.settings.permissions.section.title': string;
  'cue.settings.permissions.section.subtitle': string;
  'cue.settings.permissions.restart_banner_title': string;
  'cue.settings.permissions.restart_banner_body': string;
  'cue.settings.permissions.screen_recording.title': string;
  'cue.settings.permissions.screen_recording.hint': string;
  'cue.settings.permissions.accessibility.title': string;
  'cue.settings.permissions.accessibility.hint': string;
  'cue.settings.permissions.microphone.title': string;
  'cue.settings.permissions.microphone.hint': string;
  'cue.settings.permissions.restart_cta': string;
  'cue.settings.permissions.restart_title': string;
  'cue.settings.permissions.allow_cta': string;
  'cue.settings.permissions.onboarding.eyebrow': string;
  'cue.settings.permissions.onboarding.rerun_title': string;
  'cue.settings.permissions.onboarding.rerun_hint': string;
  'cue.settings.permissions.onboarding.rerun_cta': string;
  'cue.settings.permissions.recheck.title': string;
  'cue.settings.permissions.recheck.hint_default': string;
  'cue.settings.permissions.recheck.hint_with_time': string;
  'cue.settings.permissions.recheck.cta': string;
  'cue.settings.permissions.system_settings.title': string;
  'cue.settings.permissions.system_settings.hint': string;
  'cue.settings.permissions.system_settings.cta': string;

  // ── Cue: Settings — About tab ────────────────────────────────────────
  'cue.settings.about.section.title': string;
  'cue.settings.about.section.subtitle': string;
  'cue.settings.about.version.title': string;
  'cue.settings.about.feedback.title': string;
  'cue.settings.about.feedback.hint': string;
  'cue.settings.about.feedback.cta': string;
  'cue.settings.about.site.title': string;
  'cue.settings.about.site.hint': string;
  'cue.settings.about.site.cta': string;
  'cue.settings.about.updates.title': string;
  'cue.settings.about.updates.install_cta': string;
  'cue.settings.about.updates.checking': string;
  'cue.settings.about.updates.check_cta': string;
  'cue.settings.about.updates.status.idle': string;
  'cue.settings.about.updates.status.checking': string;
  'cue.settings.about.updates.status.available': string;
  'cue.settings.about.updates.status.downloading': string;
  'cue.settings.about.updates.status.ready': string;
  'cue.settings.about.updates.status.not_available': string;
  'cue.settings.about.updates.status.error': string;
  'cue.settings.about.err.generic': string;

  // ── Cue: Compact screen ──────────────────────────────────────────────
  'cue.compact.input.placeholder_default': string;
  'cue.compact.input.placeholder_thinking': string;
  'cue.compact.input.placeholder_with_screenshot': string;
  'cue.compact.btn.screenshot_area_title': string;
  'cue.compact.btn.history_title': string;
  'cue.compact.btn.settings_title': string;
  'cue.compact.pill.model_title': string;
  'cue.compact.pill.model_signed_out_title': string;
  'cue.compact.status.ready': string;
  'cue.compact.status.need_sign_in': string;
  'cue.compact.status.streaming': string;
  'cue.compact.status.error_prefix': string;
  'cue.compact.error.notify': string;
  'cue.compact.session_label': string;
  'cue.compact.cursor_lock_title': string;
  'cue.compact.report_ready_title': string;
  'cue.compact.preview.ready': string;
  'cue.compact.preview.add_question': string;
  'cue.compact.preview.retake': string;
  'cue.compact.preview.cancel_title': string;
  'cue.compact.preview.recording_title': string;
  'cue.compact.plan_badge_title': string;

  // ── Cue: Expanded screen ─────────────────────────────────────────────
  'cue.expanded.persona_switch_title': string;
  'cue.expanded.persona_switch_aria': string;
  'cue.expanded.model_switch_title': string;
  'cue.expanded.model_switch_aria': string;
  'cue.expanded.btn.history_title': string;
  'cue.expanded.btn.settings_title': string;
  'cue.expanded.btn.close_title': string;
  'cue.expanded.input.placeholder_listening': string;
  'cue.expanded.input.placeholder_continue': string;
  'cue.expanded.autosend.title': string;
  'cue.expanded.autosend.label': string;
  'cue.expanded.btn.screenshot_title': string;
  'cue.expanded.btn.send_title': string;
  'cue.expanded.btn.send_aria': string;
  'cue.expanded.plan_title': string;
  'cue.expanded.voice.listen': string;
  'cue.expanded.voice.menu_title_active': string;
  'cue.expanded.voice.menu_title_idle': string;
  'cue.expanded.voice.system_label': string;
  'cue.expanded.voice.system_hint': string;
  'cue.expanded.voice.mic_label': string;
  'cue.expanded.voice.mic_hint': string;
  'cue.expanded.live.system': string;
  'cue.expanded.live.mic': string;
  'cue.expanded.live.error_system_label': string;
  'cue.expanded.live.error_mic_label': string;
  'cue.expanded.speakers.eyebrow': string;
  'cue.expanded.docs.attached_doc_one': string;
  'cue.expanded.docs.attached_doc_few': string;
  'cue.expanded.docs.attached_doc_many': string;
  'cue.expanded.docs.attached_title': string;
  'cue.expanded.prep.label_default': string;
  'cue.expanded.prep.title_active_prefix': string;
  'cue.expanded.prep.title_active_loaded': string;
  'cue.expanded.prep.title_idle': string;
  'cue.expanded.actions.overflow_title': string;
  'cue.expanded.actions.open_summary': string;
  'cue.expanded.actions.save_to_hone': string;
  'cue.expanded.actions.export_md': string;
  'cue.expanded.suggest.placeholder_thinking': string;
  'cue.expanded.suggest.q_prefix': string;
  'cue.expanded.suggest.cta_insert': string;
  'cue.expanded.suggest.cta_dismiss': string;
  'cue.expanded.suggest.insert_title': string;
  'cue.expanded.suggest.dismiss_title': string;
  'cue.expanded.thinking_label': string;
  'cue.expanded.context.title_prefix': string;
  'cue.expanded.context.in_llm': string;
  'cue.expanded.context.threshold': string;
  'cue.expanded.context.summary_chars': string;
  'cue.expanded.context.summary_empty': string;
  'cue.expanded.compaction_notice': string;

  // ── Cue: Expanded — Empty state ──────────────────────────────────────
  'cue.empty.tagline': string;
  'cue.empty.persona_suffix': string;
  'cue.empty.shortcut.all_commands': string;
  'cue.empty.shortcut.explain_view': string;
  'cue.empty.shortcut.screenshot_area': string;
  'cue.empty.shortcut.switch_persona': string;
  'cue.empty.shortcut.hide_window': string;

  // ── Cue: Expanded — Message bubble ───────────────────────────────────
  'cue.message.screenshot_label': string;
  'cue.message.zoom_title': string;
  'cue.message.alt.screenshot': string;
  'cue.message.empty': string;
  'cue.message.err.signin_title': string;
  'cue.message.err.signin_body': string;
  'cue.message.err.rate_limited': string;
  'cue.message.err.model_unavailable': string;
  'cue.message.err.invalid_input': string;
  'cue.message.err.internal': string;
  'cue.message.err.transport': string;

  // ── Cue: Picker / Persona / Model ────────────────────────────────────
  'cue.picker.loading_personas': string;
  'cue.picker.personas_unavailable': string;
  'cue.picker.personas_unavailable_hint': string;
  'cue.picker.catalog_empty': string;
  'cue.picker.catalog_empty_hint': string;
  'cue.picker.models_unavailable': string;
  'cue.picker.models_unavailable_hint': string;
  'cue.picker.plan_no_models': string;
  'cue.persona_dropdown.label': string;
  'cue.persona_dropdown.empty': string;
  'cue.model_dropdown.label': string;
  'cue.model_dropdown.empty': string;
  'cue.model_dropdown.manage': string;
  'cue.provider_picker.placeholder': string;
  'cue.provider_picker.signin_required_title': string;
  'cue.provider_picker.signin_required_body': string;
  'cue.provider_picker.catalog_failed_title': string;
  'cue.provider_picker.catalog_failed_body': string;
  'cue.provider_picker.not_found': string;
  'cue.provider_picker.available': string;
  'cue.provider_picker.locked': string;

  // ── Cue: Command palette ─────────────────────────────────────────────
  'cue.palette.placeholder': string;
  'cue.palette.aria_label': string;
  'cue.palette.empty': string;
  'cue.palette.nav_label': string;
  'cue.palette.run_label': string;
  'cue.palette.close_label': string;
  'cue.palette.history_label': string;
  'cue.palette.history_hint': string;
  'cue.palette.persona_label': string;
  'cue.palette.persona_hint': string;
  'cue.palette.model_label': string;
  'cue.palette.screenshot_label': string;
  'cue.palette.settings_label': string;
  'cue.palette.summary_label': string;
  'cue.palette.summary_hint': string;
  'cue.palette.export_md_label': string;
  'cue.palette.export_md_hint': string;
  'cue.palette.save_hone_label': string;
  'cue.palette.save_hone_hint': string;
  'cue.palette.clear_chat_label': string;
  'cue.palette.clear_chat_hint': string;
  'cue.palette.upgrade_label': string;
  'cue.palette.upgrade_hint': string;
  'cue.palette.refresh_quota_label': string;
  'cue.palette.refresh_quota_hint': string;
  'cue.palette.quit_label': string;

  // ── Cue: Onboarding ──────────────────────────────────────────────────
  'cue.onboarding.welcome.title': string;
  'cue.onboarding.welcome.body': string;
  'cue.onboarding.welcome.body_followup': string;
  'cue.onboarding.welcome.cta': string;
  'cue.onboarding.welcome.note': string;
  'cue.onboarding.permissions.title': string;
  'cue.onboarding.permissions.body': string;
  'cue.onboarding.permissions.screen.title': string;
  'cue.onboarding.permissions.screen.why': string;
  'cue.onboarding.permissions.mic.title': string;
  'cue.onboarding.permissions.mic.why': string;
  'cue.onboarding.permissions.a11y.title': string;
  'cue.onboarding.permissions.a11y.why': string;
  'cue.onboarding.permissions.optional': string;
  'cue.onboarding.permissions.granted': string;
  'cue.onboarding.permissions.denied_banner_title': string;
  'cue.onboarding.permissions.denied_banner_body': string;
  'cue.onboarding.permissions.open_settings': string;
  'cue.onboarding.permissions.cta.later': string;
  'cue.onboarding.permissions.later_title': string;
  'cue.onboarding.permissions.cta.next': string;
  'cue.onboarding.permissions.cta.requesting': string;
  'cue.onboarding.permissions.cta.grant': string;
  'cue.onboarding.invisible.title': string;
  'cue.onboarding.invisible.body': string;
  'cue.onboarding.invisible.self_label': string;
  'cue.onboarding.invisible.self_subtitle': string;
  'cue.onboarding.invisible.viewer_label': string;
  'cue.onboarding.invisible.viewer_subtitle_on': string;
  'cue.onboarding.invisible.viewer_subtitle_off': string;
  'cue.onboarding.invisible.stealth_prefix': string;
  'cue.onboarding.invisible.stealth_on': string;
  'cue.onboarding.invisible.stealth_off': string;
  'cue.onboarding.invisible.settings_note': string;
  'cue.onboarding.invisible.footer_note': string;
  'cue.onboarding.invisible.cta': string;
  'cue.onboarding.complete.title': string;
  'cue.onboarding.complete.body': string;
  'cue.onboarding.complete.hotkey.toggle_label': string;
  'cue.onboarding.complete.hotkey.toggle_note': string;
  'cue.onboarding.complete.hotkey.area_label': string;
  'cue.onboarding.complete.hotkey.area_note': string;
  'cue.onboarding.complete.hotkey.full_label': string;
  'cue.onboarding.complete.hotkey.full_note': string;
  'cue.onboarding.complete.hotkey.polish_label': string;
  'cue.onboarding.complete.hotkey.polish_note': string;
  'cue.onboarding.complete.hotkey.assist_label': string;
  'cue.onboarding.complete.hotkey.assist_note': string;
  'cue.onboarding.complete.footer_settings': string;
  'cue.onboarding.complete.hone_prefix': string;
  'cue.onboarding.complete.cta': string;

  // ── Cue: Interview prep wizard ───────────────────────────────────────
  'cue.prep.eyebrow': string;
  'cue.prep.step.cv': string;
  'cue.prep.step.jd': string;
  'cue.prep.step.review': string;
  'cue.prep.step.launch': string;
  'cue.prep.step_counter': string;
  'cue.prep.close_title': string;
  'cue.prep.confirm_close': string;
  'cue.prep.footer.back': string;
  'cue.prep.footer.next': string;
  'cue.prep.footer.start': string;
  'cue.prep.footer.hint': string;
  'cue.prep.cv.title': string;
  'cue.prep.cv.body': string;
  'cue.prep.cv.source_title': string;
  'cue.prep.cv.no_file': string;
  'cue.prep.cv.pick_file': string;
  'cue.prep.cv.formats_hint': string;
  'cue.prep.cv.paste_label': string;
  'cue.prep.cv.placeholder': string;
  'cue.prep.cv.parsing': string;
  'cue.prep.cv.parse_cta': string;
  'cue.prep.cv.recognized_title': string;
  'cue.prep.cv.recognized_hint': string;
  'cue.prep.cv.field.name': string;
  'cue.prep.cv.field.current_role': string;
  'cue.prep.cv.field.experience': string;
  'cue.prep.cv.field.experience_years': string;
  'cue.prep.cv.field.top_skills': string;
  'cue.prep.cv.field.education': string;
  'cue.prep.cv.field.summary': string;
  'cue.prep.cv.err.required': string;
  'cue.prep.cv.err.extract_failed': string;
  'cue.prep.jd.title': string;
  'cue.prep.jd.body': string;
  'cue.prep.jd.source_title': string;
  'cue.prep.jd.source_subtitle': string;
  'cue.prep.jd.text_label': string;
  'cue.prep.jd.text_placeholder': string;
  'cue.prep.jd.url_label': string;
  'cue.prep.jd.url_placeholder': string;
  'cue.prep.jd.url_hint': string;
  'cue.prep.jd.parsing': string;
  'cue.prep.jd.parse_cta': string;
  'cue.prep.jd.recognized_title': string;
  'cue.prep.jd.recognized_hint': string;
  'cue.prep.jd.field.company': string;
  'cue.prep.jd.field.role': string;
  'cue.prep.jd.field.seniority': string;
  'cue.prep.jd.field.key_skills': string;
  'cue.prep.jd.err.required': string;
  'cue.prep.jd.err.url_fetch': string;
  'cue.prep.review.title': string;
  'cue.prep.review.body': string;
  'cue.prep.review.cv_title': string;
  'cue.prep.review.cv_subtitle': string;
  'cue.prep.review.jd_title': string;
  'cue.prep.review.jd_subtitle': string;
  'cue.prep.review.edit_cv': string;
  'cue.prep.review.edit_jd': string;
  'cue.prep.review.start_cta': string;
  'cue.prep.review.starting': string;
  'cue.prep.launch.title': string;
  'cue.prep.launch.body': string;
  'cue.prep.launch.active_title': string;
  'cue.prep.launch.field.experience': string;
  'cue.prep.launch.open_cue': string;
  'cue.prep.launch.opening': string;

  // ── Cue: English Polish screen ───────────────────────────────────────
  'cue.polish.eyebrow': string;
  'cue.polish.tier.strong': string;
  'cue.polish.tier.mid': string;
  'cue.polish.tier.weak': string;
  'cue.polish.regrade': string;
  'cue.polish.close': string;
  'cue.polish.cb_read_failed': string;
  'cue.polish.idle_hint': string;
  'cue.polish.grading': string;
  'cue.polish.empty_clipboard': string;
  'cue.polish.no_issues': string;
  'cue.polish.cat.grammar': string;
  'cue.polish.cat.vocab': string;
  'cue.polish.cat.style': string;
  'cue.polish.cat.clarity': string;
  'cue.polish.copied': string;
  'cue.polish.copy_fix': string;

  // ── Cue: History screen ──────────────────────────────────────────────
  'cue.history.title': string;
  'cue.history.dialog.one': string;
  'cue.history.dialog.few': string;
  'cue.history.dialog.many': string;
  'cue.history.clear_title': string;
  'cue.history.clear_confirm': string;
  'cue.history.clear_cta': string;
  'cue.history.close_title': string;
  'cue.history.esc_hint': string;
  'cue.history.search_placeholder': string;
  'cue.history.search_aria': string;
  'cue.history.show_more': string;
  'cue.history.loading': string;
  'cue.history.empty_title': string;
  'cue.history.empty_body': string;
  'cue.history.search_empty': string;
  'cue.history.dialog_not_found': string;
  'cue.history.row.untitled': string;
  'cue.history.row.message_label': string;
  'cue.history.row.rename_title': string;
  'cue.history.row.delete_title': string;

  // ── Cue: Area overlay ────────────────────────────────────────────────
  'cue.area.hint_select': string;
  'cue.area.hint_submit': string;
  'cue.area.hint_cancel': string;

  // ── Cue: Toast / Modal Paywall ───────────────────────────────────────
  'cue.paywall.title_default': string;
  'cue.paywall.body': string;
  'cue.paywall.close_title': string;
  'cue.paywall.close_aria': string;
  'cue.paywall.footer_note': string;
  'cue.paywall.paid_already': string;
  'cue.paywall.checking': string;
  'cue.paywall.plan_popular': string;
  'cue.paywall.plan_current_badge': string;
  'cue.paywall.plan_current_cta': string;
  'cue.paywall.plan_soon_cta': string;
  'cue.paywall.rate_limited_reason': string;

  // ── Cue: Summary modal ───────────────────────────────────────────────
  'cue.summary.copy_title': string;
  'cue.summary.copied_ok': string;
  'cue.summary.copy_failed': string;
  'cue.summary.report_title': string;
  'cue.summary.web_session_title': string;
  'cue.summary.open_in_browser': string;
  'cue.summary.view_on_web': string;
  'cue.summary.close_title': string;
  'cue.summary.continue_session': string;
  'cue.summary.empty_title': string;
  'cue.summary.empty_hint': string;
  'cue.summary.transcript_empty_title': string;
  'cue.summary.transcript_empty_hint': string;
  'cue.summary.tokens_unavailable': string;
  'cue.summary.section_scores_empty': string;
  'cue.summary.atlas_review_title': string;
  'cue.summary.transcript_streaming': string;
  'cue.summary.transcript_empty_inline': string;
  'cue.summary.notes.open_in_hone': string;
  'cue.summary.notes.show_in_finder': string;
  'cue.summary.notes.open_title': string;
  'cue.summary.notes.show_title': string;
  'cue.summary.notes.hone_missing': string;
  'cue.summary.export_default_title': string;

  // ── Cue: Code block ──────────────────────────────────────────────────
  'cue.markdown.copied': string;
  'cue.markdown.copy': string;

  // ── Cue: Stores / Notifications / Errors ─────────────────────────────
  'cue.store.audio.err_record': string;
  'cue.store.audio.err_start': string;
  'cue.store.audio.label_mic': string;
  'cue.store.audio.label_system': string;
  'cue.store.audio.speaker_me': string;
  'cue.store.audio.speaker_them': string;
  'cue.store.audio.speaker_n': string;
  'cue.store.conv.transport_lost': string;
  'cue.store.conv.stream_broken': string;
  'cue.store.history.default_title': string;
  'cue.store.persona.default_label': string;
  'cue.store.interview_prep.cv_required': string;
  'cue.store.interview_prep.jd_required': string;
  'cue.store.interview_prep.jd_url_failed': string;
  'cue.store.interview_prep.cv_extract_failed': string;
  'cue.store.shared.err_request': string;
  'cue.store.export.model_label': string;

  // ── Cue: HotkeyRecorder ──────────────────────────────────────────────
  'cue.hotkey.recording_prompt': string;
  'cue.hotkey.click_to_rebind': string;
  'cue.hotkey.reset': string;

  // ── Cue: QuotaMeterMini tooltip ──────────────────────────────────────
  'cue.quota.tooltip.danger': string;
  'cue.quota.tooltip.warn': string;
  'cue.quota.tooltip.normal': string;

  // ── Cue: Voice consent prompt ────────────────────────────────────────
  'cue.voice_consent.prompt': string;

  // ── Hone: Dock (Wave 16 tail) ────────────────────────────────────────
  'hone.dock.mode.pomodoro': string;
  'hone.dock.mode.countdown': string;
  'hone.dock.mode.stopwatch': string;
  'hone.dock.mode.free': string;
  'hone.dock.mode.plan': string;
  'hone.dock.mode.pinned': string;
  'hone.dock.reset_title': string;

  // ── Hone: ExternalActivityModal (Wave 16 tail) ───────────────────────
  'hone.external.err.duration_range': string;
  'hone.external.header': string;
  'hone.external.cta.cancel': string;

  // ── Hone: Calendar subtitle (Wave 16 tail) ───────────────────────────
  'hone.calendar.subtitle': string;

  // ── Hone: CrossAppReminder footer (Wave 16 tail) ─────────────────────
  'hone.coach.cross.footer_lead': string;
  'hone.coach.cross.footer_link_intro': string;

  // ── Hone: MemoryTimeline (Wave 16 tail) ──────────────────────────────
  'hone.memory.header.detail': string;
  'hone.memory.list.cue_session': string;
  'hone.memory.list.reflection': string;
  'hone.memory.list.mock_complete': string;
  'hone.memory.list.note_external': string;

  // ── Hone: Notes editor AI badge (Wave 16 tail) ───────────────────────
  'hone.notes.editor.ai_excluded_title': string;
  'hone.notes.editor.ai_visible_title': string;

  // ── Hone: Notes sidebar Cue empty (Wave 16 tail) ─────────────────────
  'hone.notes.sidebar.cue_empty_lead': string;
  'hone.notes.sidebar.cue_empty_help': string;

  // ── Hone: OnboardingModal Free features (Wave 16 tail) ───────────────
  'hone.onboarding.free.ai_coach': string;

  // ── Hone: ResistanceModal pinned (Wave 16 tail) ──────────────────────
  'hone.resistance.pinned_hint': string;

  // ── Hone: StatsOverlay / Stats (Wave 16 tail) ────────────────────────
  'hone.stats_overlay.topic_empty': string;
  'hone.stats.err_load_label': string;

  // ── Hone: TasksSuggestionsCard (Wave 16 tail) ────────────────────────
  'hone.taskboard.suggest.title_from_notes': string;

  // ── Hone: Home timer tooltip (Wave 16 tail) ──────────────────────────
  'hone.home.timer_title': string;

  // ── Hone: TaskCardView rename hint (Wave 16 tail) ────────────────────
  'hone.taskboard.dblclick_rename_title': string;

  // ── Hone: Settings — Resistance pulse hint (Wave 16 tail) ────────────
  'hone.settings.resistance.hint': string;
}
