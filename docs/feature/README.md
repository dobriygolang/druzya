# docs/feature — текущие инициативы

Активные продуктовые initiative. Закрытые волны не храним — история живёт в коде + git log.

**Последнее обновление:** 2026-05-12

## Содержание

| Файл | О чём |
|---|---|
| [identity.md](identity.md) | **Каноническая identity** (2026-05-11 clarification): AI-guide, ranking-proxy, freemium, что мы НЕ |
| [ai-tutor.md](ai-tutor.md) | AI-tutor architecture (4-слойная память) — episodic / facts / summary / persona |
| [implementation-plan.md](implementation-plan.md) | Phase progress pointer (закрытые фазы) + текущий focus |

## Стратегический контекст (TL;DR)

druz9 = **AI-guide** который watches external learning + ставит цели + предсказывает готовность. **Не** content platform.

**Three surfaces:** web (entry + AI-mock + content), Hone (daily focus, solo), Cue (stealth tray).

**3 tracks:** Go senior · ML engineering · English (opt-in).

## Текущий focus

**Phases A-H полностью shipped 2026-05-12** в single-day marathon session (17 parallel agents). Phase I (final polish + Admin Phase 3 + launch readiness) — текущая.

Полный snapshot реализации в [implementation-plan.md](implementation-plan.md). Что осталось:
- **Admin Phase 3** (~6 weeks): A/B test framework, Audit log, Fine-grained roles
- **Cue process masquerade builds** (~1-2 weeks): signed Notes.app / Telegram.app separate bundles (runtime tray swap уже live)
- **Polish post-launch:** Light theme kill switch, browser extension Firefox port, Stripe trial periods/refunds/multi-currency, voice audio upload, Hone Dock 6 focus modes (currently 2)

## Правила работы с папкой

1. Активная инициатива → файл здесь. Закрылась → удаляем
2. Каждый файл self-contained, читается отдельно
3. Decision log в начале файла: цель → tradeoffs → план. Не narrative
4. **При расхождении с реальностью — доверяй коду и обновляй документ**
