// LegalPrivacyPage — Privacy Policy.
//
// Строим под 152-ФЗ РФ (о персональных данных). Хост PG в РФ, CDN
// региональный — data locality обеспечена. Для enterprise-SKU на Year 2
// добавится отдельный DPA.
import { Link } from 'react-router-dom'

const LAST_UPDATED = '24 апреля 2026'

export default function LegalPrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 bg-black/85 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-[860px] items-center justify-between">
          <Link to="/welcome" className="font-display text-[15px] font-semibold text-white">
            druz9
          </Link>
          <nav className="flex gap-5 text-[13px] text-white/60">
            <Link to="/legal/terms" className="hover:text-white">
              Terms
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
          Privacy Policy
        </div>
        <h1 className="mt-3 font-display text-[36px] font-normal tracking-[-0.025em] text-white sm:text-[44px]">
          Политика приватности
        </h1>
        <p className="mt-3 text-[12.5px] text-white/50">Последнее обновление: {LAST_UPDATED}</p>

        <article className="mt-10 space-y-8 text-[14.5px] leading-[1.7] text-white/80">
          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">1. Что мы собираем</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Учётные данные</b>: id пользователя Yandex/Telegram, имя и
                аватар (если провайдер отдаёт).
              </li>
              <li>
                <b>Focus-сессии</b>: момент старта/конца, длительность, привязка к
                задаче (если вы её задали). Для streak'а и статистики.
              </li>
              <li>
                <b>Заметки и whiteboard</b>: полный текст/содержимое в виде,
                который вы ввели. Шифруются at rest.
              </li>
              <li>
                <b>Skill-прогресс</b>: результаты кат, мок-интервью, рейтинг в
                Arena.
              </li>
              <li>
                <b>Telemetry</b>: crash-репорты (main + renderer через Sentry).
                Отправляются только при падении, без пользовательских данных.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">2. Чего мы НЕ собираем</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Снимки экрана, аудио, файлы с диска — никогда.</li>
              <li>
                Email и пароли. Аутентификация делегирована Yandex ID / Telegram.
              </li>
              <li>
                Третьим-сторонам (реклама, analytics-платформы) — ничего. Мы не
                интегрируем Google Analytics / Amplitude / Mixpanel.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">3. Где хранится</h2>
            <p>
              Primary storage — Postgres в РФ (Selectel, MSK). Embeddings
              (bge-small) — в той же БД, как float4[] массив. Session tokens —
              Redis в РФ. Никакие персональные данные не реплицируются за
              пределы РФ. Исключение: crash-report через Sentry — сервера
              Sentry в ЕС, попадают только stack-trace'ы без пользовательских
              данных.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">4. AI-провайдеры</h2>
            <p>
              Для AI-фич (plan-synthesis, critique, suggest) мы используем
              OpenRouter → OpenAI / DeepSeek / Qwen. Payload'ом идёт только та
              часть данных, которая нужна для задачи (список weak-skill'ов
              для плана, whiteboard JSON для критики). Мы НЕ отправляем вашу
              личность, ID, email. OpenRouter хранит запросы до 30 дней для
              отладки — отключаем если вы указали opt-out в настройках.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">5. Ваши права (152-ФЗ)</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Доступ</b> — экспорт всех ваших данных в JSON через
                настройки профиля.
              </li>
              <li>
                <b>Исправление</b> — все данные редактируются в интерфейсе;
                заметки/whiteboard — прямо там где создали, streak — через
                поддержку.
              </li>
              <li>
                <b>Удаление</b> — &laquo;Удалить аккаунт&raquo; в настройках
                профиля уничтожает всё необратимо в течение 7 дней.
              </li>
              <li>
                <b>Ограничение обработки</b> — отключение AI-фич в настройках
                профиля (Free tier без AI полностью локален на стороне
                сервера).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">6. Cookies</h2>
            <p>
              Сессионные cookies (HttpOnly, Secure) для refresh-токена.
              Аналитических cookies нет. Ни Facebook Pixel, ни VK pixel.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">7. Дети</h2>
            <p>
              Сервис ориентирован на разработчиков и не предназначен для
              детей до 14 лет. Если вы обнаружили аккаунт несовершеннолетнего
              — напишите на <code className="rounded bg-white/10 px-1.5 py-0.5">abuse@druz9.ru</code>,
              удалим.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">8. Инциденты</h2>
            <p>
              В случае data-breach'а мы уведомляем затронутых пользователей в
              течение 72 часов по каналу связи, указанному в настройках, и
              публикуем post-mortem в blog'е.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-white">9. Контакты</h2>
            <p>
              DPO / privacy-вопросы — <code className="rounded bg-white/10 px-1.5 py-0.5">privacy@druz9.ru</code>.
            </p>
          </section>
        </article>

        <div className="mt-16 border-t border-white/10 pt-6 text-[12.5px] text-white/40">
          Финальная редактура с юристом по 152-ФЗ и GDPR (для ЕС-пользователей
          через VPN) ожидается до public v1 launch'а.
        </div>
      </main>
    </div>
  )
}
