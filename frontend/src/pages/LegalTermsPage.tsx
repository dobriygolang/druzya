// LegalTermsPage — публичные Terms of Service. Минимально необходимый
// контракт для public v1 launch'а: пользователь, сервис, данные,
// ограничения ответственности, terminate. Юридическую редактуру
// пропускаем через юриста до public-launch'а.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function LegalTermsPage() {
  const { t } = useTranslation('pages')
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header
        className="border-b px-6 py-5 backdrop-blur"
        style={{
          borderColor: 'rgba(var(--ink), 0.10)',
          background: 'rgba(0, 0, 0, 0.85)',
        }}
      >
        <div className="mx-auto flex max-w-[860px] items-center justify-between">
          <Link
            to="/welcome"
            className="font-display text-[15px] font-semibold tracking-[0.08em] text-text-primary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)]"
          >
            druz9
          </Link>
          <nav className="flex gap-5 text-[13px]" style={{ color: 'rgba(var(--ink), 0.60)' }}>
            <Link
              to="/legal/privacy"
              className="tracking-[0.08em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
            >
              {t('legal_terms.nav.privacy')}
            </Link>
            <Link
              to="/hone"
              className="tracking-[0.08em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
            >
              {t('legal_terms.nav.hone')}
            </Link>
            <Link
              to="/copilot"
              className="tracking-[0.08em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
            >
              {t('legal_terms.nav.cue')}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16">
        <div
          className="font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ color: 'rgba(var(--ink), 0.40)' }}
        >
          {t('legal_terms.eyebrow')}
        </div>
        <h1 className="mt-3 font-display text-[36px] font-normal tracking-[-0.025em] text-text-primary sm:text-[44px]">
          {t('legal_terms.title')}
        </h1>
        <p className="mt-3 text-[12.5px]" style={{ color: 'rgba(var(--ink), 0.50)' }}>
          {t('legal_terms.last_updated', { date: t('legal_terms.last_updated_date') })}
        </p>

        <article
          className="mt-10 space-y-8 text-[14.5px] leading-[1.7]"
          style={{ color: 'rgba(var(--ink), 0.80)' }}
        >
          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section1.h')}</h2>
            <p>{t('legal_terms.section1.p')}</p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section2.h')}</h2>
            <p>{t('legal_terms.section2.p')}</p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section3.h')}</h2>
            <p>{t('legal_terms.section3.p')}</p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section4.h')}</h2>
            <p>
              {t('legal_terms.section4.p_pre')}
              <Link
                to="/legal/privacy"
                className="underline transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
              >
                {t('legal_terms.section4.privacy_link')}
              </Link>
              {t('legal_terms.section4.p_post')}
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section5.h')}</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t('legal_terms.section5.li1')}</li>
              <li>{t('legal_terms.section5.li2')}</li>
              <li>{t('legal_terms.section5.li3')}</li>
              <li>{t('legal_terms.section5.li4')}</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section6.h')}</h2>
            <p>{t('legal_terms.section6.p')}</p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section7.h')}</h2>
            <p>{t('legal_terms.section7.p')}</p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section8.h')}</h2>
            <p>{t('legal_terms.section8.p')}</p>
          </section>

          <section>
            <h2 className="mb-3 text-[18px] font-medium text-text-primary">{t('legal_terms.section9.h')}</h2>
            <p>
              {t('legal_terms.section9.p_pre')}
              <code
                className="rounded px-1.5 py-0.5"
                style={{ background: 'rgba(var(--ink), 0.10)' }}
              >
                legal@druz9.ru
              </code>
              {t('legal_terms.section9.p_mid')}
              <code
                className="rounded px-1.5 py-0.5"
                style={{ background: 'rgba(var(--ink), 0.10)' }}
              >
                abuse@druz9.ru
              </code>
              {t('legal_terms.section9.p_post')}
            </p>
          </section>
        </article>

        <div
          className="mt-16 border-t pt-6 text-[12.5px]"
          style={{
            borderColor: 'rgba(var(--ink), 0.10)',
            color: 'rgba(var(--ink), 0.40)',
          }}
        >
          {t('legal_terms.footer_note')}
        </div>
      </main>
    </div>
  )
}
