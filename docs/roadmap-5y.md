# druz9 — 5-летняя дорожная карта

> Документ для инвесторов и стратегических партнёров.
> Последнее обновление: апрель 2026.
> Контакт: founder@druz9.online

---

## TL;DR

druz9 — **Strava для разработчиков**: PvP-платформа с подготовкой к собеседованиям, когортами, командной игрой и AI-инструментами. Цель — занять нишу "соревновательного программирования + карьерного развития" между LeetCode (одинокая практика) и Discord (соц-без структуры).

**Почему сейчас:**
- LeetCode выдыхается — те же задачи 10 лет, нет коммьюнити, RU-сегмент особенно слаб
- AI-собеседования становятся стандартом — нужна тренировка с/без AI-помощника
- Удалёнка убила корпоративные cohort'ы — разработчики ищут "свою команду" вне работы
- Геймификация в edu-tech — Duolingo доказал ARPU $20+/месяц только за streak'и

**3-летняя цель:** 500k MAU, $5M ARR, EBITDA-positive в год 2.
**5-летняя цель:** 5M MAU, $50M ARR, выход на международный рынок (TR / IN / LATAM первыми).

---

## Год 1 (2026) — MVP & Product–Market Fit

### Q2 (текущий)
- ✅ Frontend (47 страниц, dark/light, i18n RU/EN, mobile)
- ✅ Дизайн-система + Pencil source-of-truth
- 🚧 Backend MVP: Auth (Yandex+Telegram), Editor+Judge0, AI Mock 1 секция, Profile, Sanctum
- 🚧 Деплой на VPS (Hetzner DE)

### Q3
- Arena 1v1 (matchmaking + ELO + WS)
- Все 5 секций в AI Mock (Algorithms, SQL, Go, System Design, Behavioral)
- Daily Kata + streak (Duolingo-style retention)
- Telegram-бот для уведомлений
- Onboarding flow (4 шага)
- **Soft-launch:** RU-комьюнити (Habr, t.me/yandex-разработчики, Avito tech-блог)

### Q4
- Когорты + War Room (командные войны)
- Replay sessions + стресс-метрика
- Boosty монетизация (Free / Искатель ₽299 / Вознёсшийся ₽799)
- Codex (подкасты)
- ClickHouse аналитика + Grafana dashboards
- **Цель:** 10k MAU, $50k ARR (200 paid users)

**KPI Y1:** DAU/MAU > 25%, D7 retention > 30%, free→premium > 5%, NPS > 40.

---

## Год 2 (2027) — Scale & Monetization

### Q1
- Tournaments (еженедельные кубки, prize pool в gems → cashout)
- Hero Cards collection (виральная коллекционная фича)
- Spectator mode + clips → социальный traffic
- Public profiles (пилот для рекрутеров — но НЕ B2B продукт пока)
- Mobile app (React Native + Expo, на базе существующего веб-кода)

### Q2
- Premium AI модели (gpt-4o, claude-sonnet) с гибким per-task overrides
- Voice mock interview (Whisper STT + TTS)
- Code Obituary auto-share в Telegram/Twitter (виральный hook)
- Interview Calendar pro (countdown plan на собес)

### Q3
- Human Mock Interview (peer-to-peer, Google Meet, оплата через внутреннюю валюту)
- Skill Atlas v2 (PoE-style web + AI-driven node unlocking)
- Discord-style голосовые комнаты для когорт
- **Запуск партнёрки** с курсами (Yandex Practicum, Skyeng) — реферальные комиссии

### Q4
- Multi-track: QA / DevOps / Data / Security / ML треки
- Necromancy mode (анонимный bug-bounty между юзерами)
- Локализация EN+ES+TR
- **Цель:** 100k MAU, $1.5M ARR, 8% conversion, 60% gross margin

**KPI Y2:** MAU 100k, paid 10k, average ARPU $12.50/mo, LTV $120, CAC < $20.

---

## Год 3 (2028) — Network Effects & Geo expansion

### Q1
- **AI Adversarial Mode** (адвокат дьявола + Hallucination Traps)
- Tournament series — оффлайн финалы в Москве, Минске, Алмате (вирусный PR)
- Native iOS/Android (parity с web)
- Twitch overlay (Streamlabs-стайл интеграция для контент-мейкеров)

### Q2
- **B2B-light:** "Dream Team" — компании создают приватный лидерборд для своих разработчиков, ходят в общую арену под брендом. ₽15k/мес/команда, не основной бизнес.
- LATAM запуск (PT-BR + ES) — UA через TikTok creator partnerships
- Mentor marketplace — опытные разработчики дают micro-mentoring за внутреннюю валюту

### Q3
- **Real Offer Simulator** (тренировка переговоров) — premium-only, ₽999/мес add-on
- Ghost Runs v2 — ML-генерируемые ghost-противники по стилю топ-игроков
- Battle pass season 5+ с реальными призами (мерч, MacBook'и, авиабилеты на конференции)

### Q4
- **EU launch** (DE+EN markets) — DSGVO compliance, MeetUp partnerships
- Skill Tree v3 — keystones открываются за командные достижения, не индивидуальные
- White-label для buty/Codecademy уровня?
- **Цель:** 1M MAU, $10M ARR, 12% conversion, $30M valuation

**KPI Y3:** MAU 1M, paid 120k, ARPU $15/mo, EBITDA-positive с Q3.

---

## Год 4 (2029) — Platform & Ecosystem

### Q1
- **API + SDK** для third-party (плагины, интеграции с GitHub Actions / Linear / Jira)
- Marketplace для tasks — комьюнити загружает свои kata, авторам ₽-роялти
- AR Code Lens — наводишь на чужой код (после матча) → визуализация алгоритма

### Q2
- **Education-as-a-Service:** "druz9 for Bootcamps" — школы (Yandex Practicum, Tech-school) встраивают арену в свои программы. Pay-per-student.
- **Enterprise SSO** + custom dungeons (Yandex/Сбер собственные kata) — ₽300k+/год contracts
- AI-симуляция конкретного интервьюера (legally clean: "стиль строгий технарь" не "имя человека")

### Q3
- Live tournaments на Twitch — лига druz9 с призовым фондом $100k, спонсоры (JetBrains, Cursor, Vercel)
- Mobile-first features: 5-min kata в очереди / в дороге, push-notif challenges
- Community-led content — top creators получают rev-share с premium-конверсий по их рефералкам

### Q4
- **Series B-ready:** $50M ARR, 3M MAU, 15% conversion, 20% growth m/m
- US-launch pilot (English market, ESL первое casino)
- **Цель:** $30M ARR, готовность к series B на $200M valuation

**KPI Y4:** Multi-revenue stream (B2C subs 60% + B2B 30% + marketplace 10%).

---

## Год 5 (2030) — Outcome & Exit Optionality

### Q1–Q2
- **AI-coach as a primary product** — премиум-тир $99/мес: персонализированный план карьеры, weekly 1-on-1 voice review, доступ к топ-менторам
- **Hire-channel pivot:** топ-100 рейтинга открыто видят job-offers от компаний-партнёров. Comp-share или fixed-fee per hire.
- Acquisitions: купить нишевые edu-проекты (e.g. interviewing.io alumni community) для cohort-bootstrap

### Q3–Q4
- **International:** US 30% MAU, EU 25%, LATAM 20%, RU+CIS 25%
- **Multi-vertical:** не только code — design (Figma challenges), data science (Kaggle-light), product management (case challenges)
- **Strategic options:**
  - **A) Independent IPO/SPAC** — $500M+ valuation, growth-route
  - **B) Strategic acquisition** — Microsoft (LinkedIn Learning + GitHub fit), HackerRank, Coursera, Roblox Edu, Google (Career Certificates)
  - **C) Roll-up:** купить competitive coding peers (HackerEarth, Codeforces commercial) и стать категорийным лидером

**Цель Y5:** $100M+ ARR, 5M MAU, готовность к series C на $1B+ valuation, или strategic exit $500M–1.5B.

---

## TAM / SAM / SOM

- **TAM (developers globally interested in interview prep):** 25M dev'ов готовятся к смене работы каждый год × средний spend $200/год на edu = **$5B/год TAM**
- **SAM (RU+CIS+EU+LATAM gamified subset):** ~3M активных users × $80/год = **$240M/год SAM**
- **SOM (год 3 цель):** 1M MAU × 12% conversion × $180/год ARPU = **$22M/год SOM**

Бенчмарки:
- LeetCode: ~12M users, ~$50M ARR (модель — premium ₽4k/мес, низкая retention)
- HackerRank: $30M ARR (сильный B2B-tilt)
- Codecademy: $100M+ ARR, $525M acquired by Skillsoft 2021
- Coursera: $530M ARR, $2B market cap (сильно дешевле peak)
- **druz9 differentiation:** PvP + community + AI-native + игровая retention механика — никто не комбинирует все четыре

---

## Финансовая модель (упрощённо)

| Год | MAU | Paid | ARPU/mo | ARR | Burn | EBITDA | Round |
|---|---|---|---|---|---|---|---|
| Y1 | 10k | 200 | $10 | $24k | $-300k | $-280k | Pre-seed $500k |
| Y2 | 100k | 8k | $12.5 | $1.2M | $-800k | $-200k | Seed $3M |
| Y3 | 1M | 120k | $15 | $21M | break-even Q3 | $+1M | Series A $15M |
| Y4 | 3M | 450k | $17 | $90M | $-3M | $+10M (reinvest) | (optional) |
| Y5 | 5M | 750k | $20 | $180M | $-5M | $+30M | Series B $50M или exit |

**Unit economics target:**
- CAC < $20 (organic первый год, Telegram/TikTok creator партнёрки потом)
- LTV > $200 (16 мес средняя retention paid)
- Gross margin > 70% (минус LLM costs ~15%, infra ~10%)
- Magic number > 1.0 от Y2

---

## Команда (план найма)

**Сейчас:** 1 founder (full-stack, дизайн через Pencil + Claude).

**Year 1 (post pre-seed):** +1 senior backend Go, +1 DevOps part-time, +1 community manager part-time. Total 4.

**Year 2 (post seed):** +2 backend, +1 frontend senior, +1 product designer, +1 data engineer (ClickHouse), +1 BizDev, +2 community/content. Total ~12.

**Year 3 (post A):** Full team — engineering 15, product/design 4, data 3, growth/marketing 8, ops/finance 3. Total ~33.

**Year 5:** ~120 человек, distributed (RU/EU/LATAM/US).

---

## Риски и mitigation

| Риск | Вероятность | Impact | Mitigation |
|---|---|---|---|
| LeetCode/HackerRank выпустят PvP | Med | High | First-mover в RU-сегменте, когорты и viral-механики копировать сложно |
| Регуляторика на сбор кода/answers | Low-Med | Med | GDPR-by-design, всё анонимизируется, opt-in publish |
| Высокий churn после собеса (нашли работу — ушли) | High | Med | Когорты = social glue, season pass = sunk-cost, mentoring = монетизация после трудоустройства |
| LLM costs растут быстрее ARR | Med | High | Hybrid: бесплатные модели (Mistral self-hosted) для free tier, premium-only для топовых, кэширование контекстов |
| RU-сегмент изолируется (sanctions) | High | Med | Geo-distribution: EU+LATAM с Y2, payment rails Boosty/Stripe/Paddle hybrid |
| Founder bottleneck | High | High | Y1 hire backend lead, Y2 product hire, Y3 — CTO найм |

---

## Что нужно от инвесторов (Pre-seed $500k → Seed $3M)

**Pre-seed use of funds:**
- Backend dev #1 (12 мес × $5k) = $60k
- DevOps part-time (12 мес × $2k) = $24k
- Community manager (6 мес × $2k) = $12k
- Hosting + LLM costs (12 мес × $2k) = $24k
- Marketing seed (UA experiments) = $50k
- Founder salary (12 мес × $4k) = $48k
- Legal + accounting + buffer = $282k
- **Total: $500k = 18 months runway → Seed milestone (10k MAU + $50k ARR validated)**

**Связь:** founder@druz9.online · t.me/druz9_founder
