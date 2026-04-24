// LegalTermsPage — публичные Terms of Service. Минимально необходимый
// контракт для public v1 launch'а: пользователь, сервис, данные,
// ограничения ответственности, terminate. Юридическую редактуру
// пропускаем через юриста до public-launch'а.
import { Link } from 'react-router-dom'

const LAST_UPDATED = '24 апреля 2026'

export default function LegalTermsPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 bg-black/85 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-[860px] items-center justify-between">
          <Link to="/welcome" className="font-display text-[15px] font-semibold text-white">
            druz9
          </Link>
          <nav className="flex gap-5 text-[13px] text-white/60">
            <Link to="/legal/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link to="/hone" className="hover:text-white">
              Hone
            </Link>
            <Link to="/copilot" className="hover:text-white">
              Cue
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
          Terms of Service
        </div>
        <h1 className="mt-3 font-display text-[36px] font-normal tracking-[-0.025em] text-white sm:text-[44px]">
          Условия использования druz9
        </h1>
        <p className="mt-3 text-[12.5px] text-white/50">Последнее обновление: {LAST_UPDATED}</p>

        <article className="mt-10 space-y-8 text-[14.5px] leading-[1.7] text-white/80">
          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">1. О сервисе</h2>
            <p>
              druz9 — экосистема из трёх продуктов: druz9.ru (веб-арена,
              рейтинг, mock-интервью), Hone (desktop focus cockpit) и Cue
              (stealth AI-copilot). Все три работают под одной учётной записью
              и одной подпиской.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">2. Аккаунт</h2>
            <p>
              Регистрация проходит через Yandex ID или Telegram. Email и пароли
              мы не храним. Вы отвечаете за сохранность доступа к учётке
              провайдера (Yandex/Telegram); скомпрометированный провайдер-аккаунт
              = скомпрометированный druz9-аккаунт.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">3. Платная подписка Pro</h2>
            <p>
              Pro стоит 790 ₽/месяц и разблокирует AI-функции во всей экосистеме
              (генерация плана дня, AI-критика whiteboard, подбор связей в
              notes, stealth-copilot в Cue, Arena Pro на druz9.ru). Отмена
              доступна в любой момент в настройках профиля; после отмены Pro
              действует до конца оплаченного периода.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">4. Приватность данных</h2>
            <p>
              Заметки и whiteboard-состояние видны только вам, зашифрованы at
              rest, никогда не попадают в Arena / рейтинг / публичные подборки.
              Focus-сессии используются для построения приватной статистики и
              не отдаются третьим сторонам. Подробно — см{' '}
              <Link to="/legal/privacy" className="underline hover:text-white">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">5. Запрещено</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Автоматизированные запросы к AI-endpoint'ам ботами / скриптами.</li>
              <li>Попытки обхода rate-limit'ов (10 запросов/мин для Suggest'а, 1/5 минут для GeneratePlan force-regeneration).</li>
              <li>
                Reverse-engineering двоичных артефактов (Hone DMG, Cue
                binary), публикация модифицированных сборок.
              </li>
              <li>Контент-фарминг для манипуляции рейтингом.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">6. Ответственность</h2>
            <p>
              AI-ответы (план, critique, mock-фидбек) — лучшая оценка языковой
              модели, не замена реального review / подготовки. Принимайте их
              как подсказку, не как источник истины. Мы не несём ответственности
              за решения, принятые на основе AI-вывода.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">7. Прекращение</h2>
            <p>
              Вы можете удалить аккаунт в любое время из настроек профиля —
              заметки, сессии, подписка уничтожаются. Мы можем отключить
              аккаунт при нарушении пункта 5 или подозрении на фрод/скомпромет,
              с уведомлением по каналу связи, который вы указали.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">8. Изменения</h2>
            <p>
              Изменения условий публикуются здесь, дата обновления — вверху.
              Существенные изменения (цена подписки, объём бесплатного tier'а)
              анонсируются за 30 дней по каналу связи или в приложении.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">9. Контакты</h2>
            <p>
              По вопросам условий — <code className="rounded bg-white/10 px-1.5 py-0.5">legal@druz9.ru</code>.
              Жалобы, abuse — <code className="rounded bg-white/10 px-1.5 py-0.5">abuse@druz9.ru</code>.
            </p>
          </section>
        </article>

        <div className="mt-16 border-t border-white/10 pt-6 text-[12.5px] text-white/40">
          Этот текст — минимальный рабочий контракт для public-beta; финальная
          редактура юристом произведена до даты public v1 launch'а.
        </div>
      </main>
    </div>
  )
}
