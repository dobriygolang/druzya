-- +goose Up
-- +goose StatementBegin

-- 00024_codex_articles_seed.sql
--
-- Восстанавливает seed для `codex_categories` + `codex_articles` —
-- 8 категорий и 22 базовые статьи, которые были утеряны при
-- консолидации миграций в 00001_baseline.sql (схема таблиц переехала,
-- INSERT'ы выпали). Та же data что в удалённой 00054_codex_articles.sql
-- (commit 7b940d6) + frontend/src/content/codex.ts CATEGORIES.
--
-- Categories идут ПЕРЕД articles потому что `codex_articles.category`
-- — FK на `codex_categories(slug)`. Иконки и цвета живут во фронте
-- (presentation), сюда едут только slug + label + sort_order.

INSERT INTO codex_categories (slug, label, sort_order) VALUES
('system_design', 'System Design', 10),
('backend',      'Backend',        20),
('algorithms',   'Алгоритмы',      30),
('career',       'Карьера',        40),
('behavioral',   'Behavioral',     50),
('concurrency',  'Concurrency',    60),
('data',         'Data / SQL',     70),
('security',     'Security',       80)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO codex_articles (slug, title, description, category, href, source, read_min, sort_order) VALUES
('cap', 'CAP-теорема', 'Consistency / Availability / Partition tolerance — почему нельзя получить всё три.', 'system_design', 'https://en.wikipedia.org/wiki/CAP_theorem', 'Wikipedia', 8, 10),
('consistent-hashing', 'Consistent Hashing', 'Шардирование без полного rehash при изменении числа узлов.', 'system_design', 'https://en.wikipedia.org/wiki/Consistent_hashing', 'Wikipedia', 12, 20),
('caching-strategies', 'Cache strategies: read-through, write-back, write-around', 'Что выбирать под чтение, под запись, под нестабильный фронтенд.', 'system_design', 'https://aws.amazon.com/caching/best-practices/', 'AWS docs', 10, 30),
('load-balancing', 'Load balancing: L4 vs L7', 'Чем NLB отличается от ALB и когда нужен sticky session.', 'system_design', 'https://en.wikipedia.org/wiki/Load_balancing_(computing)', 'Wikipedia', 9, 40),
('rest-vs-grpc', 'REST vs gRPC', 'Кейсы, где gRPC выигрывает, и где REST остаётся правильным выбором.', 'backend', 'https://grpc.io/docs/what-is-grpc/introduction/', 'grpc.io', 11, 10),
('http-2', 'HTTP/2: multiplexing, server push, HPACK', 'Как HTTP/2 устранил head-of-line blocking уровня соединения.', 'backend', 'https://datatracker.ietf.org/doc/html/rfc7540', 'RFC 7540', 14, 20),
('idempotency', 'Идемпотентность HTTP-запросов', 'Зачем нужны Idempotency-Key и как их хранить.', 'backend', 'https://developer.mozilla.org/en-US/docs/Glossary/Idempotent', 'MDN', 7, 30),
('sliding-window', 'Sliding Window', 'Шаблон, превращающий O(n²) перебор подмассивов в O(n).', 'algorithms', 'https://en.wikipedia.org/wiki/Sliding_window_protocol', 'Wikipedia', 9, 10),
('two-pointers', 'Two Pointers', 'Когда левый/правый указатель экономит память относительно хеш-таблицы.', 'algorithms', 'https://en.wikipedia.org/wiki/Pointer_(computer_programming)', 'Wikipedia', 8, 20),
('union-find', 'Union-Find (DSU)', 'Path compression + union by rank — почти O(1) на операцию.', 'algorithms', 'https://en.wikipedia.org/wiki/Disjoint-set_data_structure', 'Wikipedia', 13, 30),
('dijkstra', 'Алгоритм Дейкстры', 'Кратчайшие пути в графе с неотрицательными весами.', 'algorithms', 'https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm', 'Wikipedia', 12, 40),
('levels-fyi', 'Гайд по уровням и компенсациям в IT', 'Как определить свой грейд и что просить на оффере.', 'career', 'https://www.levels.fyi/', 'levels.fyi', 15, 10),
('salary-negotiation', 'Переговоры по офферу', 'Почему первая цифра рекрутера — не последняя.', 'career', 'https://www.kalzumeus.com/2012/01/23/salary-negotiation/', 'kalzumeus.com', 18, 20),
('star-method', 'STAR-метод', 'Situation / Task / Action / Result — структура любого ответа на behavioral.', 'behavioral', 'https://en.wikipedia.org/wiki/Situation,_task,_action,_result', 'Wikipedia', 6, 10),
('go-context', 'context.Context в Go', 'Cancellation, deadlines, request-scoped values — официальные best practices.', 'concurrency', 'https://pkg.go.dev/context', 'pkg.go.dev', 11, 10),
('goroutines', 'Горутины и каналы', 'Tour of Go: как мыслить в концепции "share memory by communicating".', 'concurrency', 'https://go.dev/tour/concurrency/1', 'go.dev', 14, 20),
('window-functions', 'Window functions в PostgreSQL', 'ROW_NUMBER, LAG, LEAD, PARTITION BY — полный референс.', 'data', 'https://www.postgresql.org/docs/current/tutorial-window.html', 'postgresql.org', 16, 10),
('indexes', 'B-tree, Hash, GIN: какие индексы есть в Postgres', 'Когда какой индекс выбрать и как читать EXPLAIN.', 'data', 'https://www.postgresql.org/docs/current/indexes-types.html', 'postgresql.org', 13, 20),
('isolation-levels', 'Уровни изоляции транзакций', 'Read Committed vs Repeatable Read vs Serializable — что и когда блокирует.', 'data', 'https://www.postgresql.org/docs/current/transaction-iso.html', 'postgresql.org', 12, 30),
('owasp-top-10', 'OWASP Top 10', 'Самые частые уязвимости веб-приложений с примерами.', 'security', 'https://owasp.org/www-project-top-ten/', 'OWASP', 20, 10),
('jwt', 'JWT: почему нельзя хранить в localStorage', 'Какие атаки этим открываются и где правильно держать токены.', 'security', 'https://datatracker.ietf.org/doc/html/rfc7519', 'RFC 7519', 9, 20)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
