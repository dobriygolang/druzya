// Статический контент страницы /codex — каталог статей-знаний.
//
// Codex задумывался как "/help, но для предметной области": ссылки на
// внешние материалы (Wikipedia / референс-доки) по System Design,
// алгоритмам, SQL, Go и behavioral. Backend для каталога не требуется —
// контент редактируется здесь и попадает в bundle на build.
//
// Если в будущем заведём собственный CMS / blog — заменить импорт в
// pages/CodexPage.tsx на useQuery к новому endpoint'у. До тех пор это
// честный statics-page без поддельной аналитики "12480 прослушиваний"
// и фейковых "↻ 87% слушают до конца".
import { createElement } from 'react';
import { Network, Database, Cpu, Briefcase, MessageCircle, GitBranch, Layers, Lock, Sparkles, } from 'lucide-react';
const ic = (Comp, cls = 'h-4 w-4') => createElement(Comp, { className: cls });
export const CODEX_CATEGORIES = [
    { slug: 'system_design', label: 'System Design', icon: ic(Network), color: 'text-cyan', bg: 'bg-cyan/15' },
    { slug: 'backend', label: 'Backend', icon: ic(Database), color: 'text-accent-hover', bg: 'bg-accent/15' },
    { slug: 'algorithms', label: 'Алгоритмы', icon: ic(Cpu), color: 'text-pink', bg: 'bg-pink/15' },
    { slug: 'career', label: 'Карьера', icon: ic(Briefcase), color: 'text-warn', bg: 'bg-warn/15' },
    { slug: 'behavioral', label: 'Behavioral', icon: ic(MessageCircle), color: 'text-success', bg: 'bg-success/15' },
    { slug: 'concurrency', label: 'Concurrency', icon: ic(GitBranch), color: 'text-cyan', bg: 'bg-cyan/15' },
    { slug: 'data', label: 'Data / SQL', icon: ic(Layers), color: 'text-accent-hover', bg: 'bg-accent/15' },
    { slug: 'security', label: 'Security', icon: ic(Lock), color: 'text-pink', bg: 'bg-pink/15' },
];
// Все ссылки — на стабильные публичные источники (Wikipedia, MDN, AWS docs,
// классические RFC). НЕ ставим ссылки на свои черновики или мёртвые
// домены — каждая запись здесь должна открываться 200 OK.
export const CODEX_ARTICLES = [
    // System Design
    {
        id: 'cap',
        title: 'CAP-теорема',
        description: 'Consistency / Availability / Partition tolerance — почему нельзя получить всё три.',
        category: 'system_design',
        read_min: 8,
        href: 'https://en.wikipedia.org/wiki/CAP_theorem',
        source: 'Wikipedia',
    },
    {
        id: 'consistent-hashing',
        title: 'Consistent Hashing',
        description: 'Шардирование без полного rehash при изменении числа узлов.',
        category: 'system_design',
        read_min: 12,
        href: 'https://en.wikipedia.org/wiki/Consistent_hashing',
        source: 'Wikipedia',
    },
    {
        id: 'caching-strategies',
        title: 'Cache strategies: read-through, write-back, write-around',
        description: 'Что выбирать под чтение, под запись, под нестабильный фронтенд.',
        category: 'system_design',
        read_min: 10,
        href: 'https://aws.amazon.com/caching/best-practices/',
        source: 'AWS docs',
    },
    {
        id: 'load-balancing',
        title: 'Load balancing: L4 vs L7',
        description: 'Чем NLB отличается от ALB и когда нужен sticky session.',
        category: 'system_design',
        read_min: 9,
        href: 'https://en.wikipedia.org/wiki/Load_balancing_(computing)',
        source: 'Wikipedia',
    },
    // Backend
    {
        id: 'rest-vs-grpc',
        title: 'REST vs gRPC',
        description: 'Кейсы, где gRPC выигрывает, и где REST остаётся правильным выбором.',
        category: 'backend',
        read_min: 11,
        href: 'https://grpc.io/docs/what-is-grpc/introduction/',
        source: 'grpc.io',
    },
    {
        id: 'http-2',
        title: 'HTTP/2: multiplexing, server push, HPACK',
        description: 'Как HTTP/2 устранил head-of-line blocking уровня соединения.',
        category: 'backend',
        read_min: 14,
        href: 'https://datatracker.ietf.org/doc/html/rfc7540',
        source: 'RFC 7540',
    },
    {
        id: 'idempotency',
        title: 'Идемпотентность HTTP-запросов',
        description: 'Зачем нужны Idempotency-Key и как их хранить.',
        category: 'backend',
        read_min: 7,
        href: 'https://developer.mozilla.org/en-US/docs/Glossary/Idempotent',
        source: 'MDN',
    },
    // Algorithms
    {
        id: 'sliding-window',
        title: 'Sliding Window',
        description: 'Шаблон, превращающий O(n²) перебор подмассивов в O(n).',
        category: 'algorithms',
        read_min: 9,
        href: 'https://en.wikipedia.org/wiki/Sliding_window_protocol',
        source: 'Wikipedia',
    },
    {
        id: 'two-pointers',
        title: 'Two Pointers',
        description: 'Когда левый/правый указатель экономит память относительно хеш-таблицы.',
        category: 'algorithms',
        read_min: 8,
        href: 'https://en.wikipedia.org/wiki/Pointer_(computer_programming)',
        source: 'Wikipedia',
    },
    {
        id: 'union-find',
        title: 'Union-Find (DSU)',
        description: 'Path compression + union by rank — почти O(1) на операцию.',
        category: 'algorithms',
        read_min: 13,
        href: 'https://en.wikipedia.org/wiki/Disjoint-set_data_structure',
        source: 'Wikipedia',
    },
    {
        id: 'dijkstra',
        title: 'Алгоритм Дейкстры',
        description: 'Кратчайшие пути в графе с неотрицательными весами.',
        category: 'algorithms',
        read_min: 12,
        href: 'https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm',
        source: 'Wikipedia',
    },
    // Career
    {
        id: 'levels-fyi',
        title: 'Гайд по уровням и компенсациям в IT',
        description: 'Как определить свой грейд и что просить на оффере.',
        category: 'career',
        read_min: 15,
        href: 'https://www.levels.fyi/',
        source: 'levels.fyi',
    },
    {
        id: 'salary-negotiation',
        title: 'Переговоры по офферу',
        description: 'Почему первая цифра рекрутера — не последняя.',
        category: 'career',
        read_min: 18,
        href: 'https://www.kalzumeus.com/2012/01/23/salary-negotiation/',
        source: 'kalzumeus.com',
    },
    // Behavioral
    {
        id: 'star-method',
        title: 'STAR-метод',
        description: 'Situation / Task / Action / Result — структура любого ответа на behavioral.',
        category: 'behavioral',
        read_min: 6,
        href: 'https://en.wikipedia.org/wiki/Situation,_task,_action,_result',
        source: 'Wikipedia',
    },
    // Concurrency
    {
        id: 'go-context',
        title: 'context.Context в Go',
        description: 'Cancellation, deadlines, request-scoped values — официальные best practices.',
        category: 'concurrency',
        read_min: 11,
        href: 'https://pkg.go.dev/context',
        source: 'pkg.go.dev',
    },
    {
        id: 'goroutines',
        title: 'Горутины и каналы',
        description: 'Tour of Go: как мыслить в концепции "share memory by communicating".',
        category: 'concurrency',
        read_min: 14,
        href: 'https://go.dev/tour/concurrency/1',
        source: 'go.dev',
    },
    // Data / SQL
    {
        id: 'window-functions',
        title: 'Window functions в PostgreSQL',
        description: 'ROW_NUMBER, LAG, LEAD, PARTITION BY — полный референс.',
        category: 'data',
        read_min: 16,
        href: 'https://www.postgresql.org/docs/current/tutorial-window.html',
        source: 'postgresql.org',
    },
    {
        id: 'indexes',
        title: 'B-tree, Hash, GIN: какие индексы есть в Postgres',
        description: 'Когда какой индекс выбрать и как читать EXPLAIN.',
        category: 'data',
        read_min: 13,
        href: 'https://www.postgresql.org/docs/current/indexes-types.html',
        source: 'postgresql.org',
    },
    {
        id: 'isolation-levels',
        title: 'Уровни изоляции транзакций',
        description: 'Read Committed vs Repeatable Read vs Serializable — что и когда блокирует.',
        category: 'data',
        read_min: 12,
        href: 'https://www.postgresql.org/docs/current/transaction-iso.html',
        source: 'postgresql.org',
    },
    // Security
    {
        id: 'owasp-top-10',
        title: 'OWASP Top 10',
        description: 'Самые частые уязвимости веб-приложений с примерами.',
        category: 'security',
        read_min: 20,
        href: 'https://owasp.org/www-project-top-ten/',
        source: 'OWASP',
    },
    {
        id: 'jwt',
        title: 'JWT: почему нельзя хранить в localStorage',
        description: 'Какие атаки этим открываются и где правильно держать токены.',
        category: 'security',
        read_min: 9,
        href: 'https://datatracker.ietf.org/doc/html/rfc7519',
        source: 'RFC 7519',
    },
];
export function codexCategoriesWithCounts() {
    const counts = new Map();
    for (const a of CODEX_ARTICLES) {
        counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    }
    return CODEX_CATEGORIES.map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }));
}
export const CODEX_TOTAL = CODEX_ARTICLES.length;
// Иконка-заглушка для "пустых" мест UI, если нужно — экспортируем
// здесь, чтобы импорт лежал в одном модуле.
export const CODEX_HERO_ICON = createElement(Sparkles, { className: 'h-6 w-6 text-accent-hover' });
