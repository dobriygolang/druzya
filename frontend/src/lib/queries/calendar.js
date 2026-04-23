// Календарь подготовки к собесу.
//
// Источник правды — `daily.GetCalendar` (proto/druz9/v1/daily.proto), REST
// alias /api/v1/daily/calendar. Тот же endpoint, что и `useCalendarQuery`
// в queries/daily.ts; здесь мы делаем тонкий адаптер, который мапит proto
// `InterviewCalendar` в shape, удобный странице /calendar.
//
// Поля, которые backend пока НЕ отдаёт (countdown / strengths / weaknesses /
// ai_recommendation / today_tasks с подзаголовками), считаются опциональными:
// страница рисует их через empty-states, без хардкода. Когда соответствующие
// домены подъедут (рекомендации — profile.GetMyReport, оценки — атлас), хук
// расширится без переразметки.
//
// Ошибка 404 = у пользователя ещё нет активного календаря; страница покажет
// CTA «Создать план». Все остальные коды → стандартный ErrorChip.
import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
const PRIORITY_RU = {
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
};
const KIND_TITLES_RU = {
    solve_task: 'Задача',
    mock: 'Mock-собес',
    native_round: 'Раунд с AI',
    podcast: 'Подкаст',
    review: 'Разбор',
};
// formatCountdown — компактный «17д 04ч 12м» из ISO-даты. Возвращает
// пустую строку, если интервью уже прошло, чтобы UI не показывал
// отрицательное «-3д».
export function formatCountdown(interviewDateISO, now = new Date()) {
    const target = new Date(interviewDateISO).getTime();
    if (Number.isNaN(target))
        return '';
    const diffMs = target - now.getTime();
    if (diffMs <= 0)
        return '';
    const totalMin = Math.floor(diffMs / 60_000);
    const days = Math.floor(totalMin / (24 * 60));
    const hours = Math.floor((totalMin - days * 24 * 60) / 60);
    const mins = totalMin - days * 24 * 60 - hours * 60;
    return `${days}д ${String(hours).padStart(2, '0')}ч ${String(mins).padStart(2, '0')}м`;
}
// adaptCalendar маппит wire → view. Сегодняшние задачи получают
// status = done | active | future: первый незакрытый — active, остальные
// после него — future.
export function adaptCalendar(wire, now = new Date()) {
    const today = wire.today ?? [];
    let activeAssigned = false;
    const todayTasks = today.map((t, idx) => {
        let status = 'future';
        if (t.done)
            status = 'done';
        else if (!activeAssigned) {
            status = 'active';
            activeAssigned = true;
        }
        const kindTitle = KIND_TITLES_RU[t.kind] ?? t.kind;
        const sub = `${kindTitle} · ${t.estimated_min} мин`;
        return { id: `${wire.id}:${idx}`, title: t.title, sub, status };
    });
    return {
        id: wire.id,
        company_id: wire.company_id,
        role: wire.role,
        interview_date: wire.interview_date,
        days_left: wire.days_left,
        readiness_pct: wire.readiness_pct,
        countdown: formatCountdown(wire.interview_date, now),
        today_tasks: todayTasks,
        week_plan: wire.week_plan ?? [],
        weak_zones: wire.weak_zones ?? [],
    };
}
export function priorityLabelRU(p) {
    return PRIORITY_RU[p] ?? p;
}
// useInterviewCalendarQuery — единственный публичный хук страницы /calendar.
// 404 не ретраим (терминальное состояние «у пользователя нет плана»);
// остальные ошибки — стандартный react-query retry.
export function useInterviewCalendarQuery() {
    return useQuery({
        queryKey: ['interview', 'calendar'],
        queryFn: async () => {
            const wire = await api('/daily/calendar');
            return adaptCalendar(wire);
        },
        staleTime: 60_000,
        retry: (failureCount, err) => {
            const status = err?.status;
            if (status === 404)
                return false;
            return failureCount < 3;
        },
    });
}
