// pathPresets — curated learning paths для нового onboarding wizard'а.
//
// Sergey 2026-05-03: hybrid model — preset OR custom; preset потом
// editable (checkbox toggle, «знаю / не знаю»).
//
// V1 — frontend-only constants. Phase 3: эти presets переедут в backend
// (`learning_path_presets` table) + AI generator для custom paths добавит
// rows в `user_custom_path_nodes`.

export interface PathPreset {
  id: string
  title: string
  blurb: string
  nodes: PresetNode[]
}

export interface PresetNode {
  id: string
  title: string
  group: string
  hint?: string
}

export const PRESETS: PathPreset[] = [
  {
    id: 'senior-go-backend',
    title: 'Senior Go backend',
    blurb: 'Algorithms · System Design · Distributed · Go runtime / GC',
    nodes: [
      { id: 'go-runtime', group: 'Go internals', title: 'Runtime: scheduler, GMP, GC' },
      { id: 'go-concurrency', group: 'Go internals', title: 'Concurrency patterns: channels, sync, errgroup' },
      { id: 'go-profiling', group: 'Go internals', title: 'Profiling: pprof, trace, escape analysis' },
      { id: 'algo-graphs', group: 'Algorithms', title: 'Graphs: BFS / DFS / Dijkstra / topo sort' },
      { id: 'algo-dp', group: 'Algorithms', title: 'Dynamic programming patterns' },
      { id: 'algo-tree', group: 'Algorithms', title: 'Trees, heap, segment tree' },
      { id: 'sd-capacity', group: 'System Design', title: 'Capacity estimation' },
      { id: 'sd-databases', group: 'System Design', title: 'Database choice (RDBMS vs NoSQL vs columnar)' },
      { id: 'sd-caching', group: 'System Design', title: 'Caching layers, invalidation, CDN' },
      { id: 'sd-queues', group: 'System Design', title: 'Async messaging: Kafka / SQS / NATS' },
      { id: 'sd-failure', group: 'System Design', title: 'Failure modes: retries, idempotency, circuit breaker' },
      { id: 'distrib-consensus', group: 'Distributed', title: 'Consensus (Raft / Paxos overview)' },
      { id: 'distrib-cap', group: 'Distributed', title: 'CAP / consistency models' },
      { id: 'sql-explain', group: 'SQL', title: 'EXPLAIN, индексы, N+1' },
      { id: 'behavior-leadership', group: 'Behavioural', title: 'Leadership stories: scope, conflict, ownership' },
    ],
  },
  {
    id: 'ml-platform-engineer',
    title: 'ML platform engineer',
    blurb: 'MLOps · Serving · Distributed training · Pipelines',
    nodes: [
      { id: 'mlops-pipelines', group: 'MLOps', title: 'Training pipelines: Airflow / Kubeflow' },
      { id: 'mlops-serving', group: 'MLOps', title: 'Model serving: Triton / TF Serving / vLLM' },
      { id: 'mlops-monitoring', group: 'MLOps', title: 'Drift detection, observability, A/B' },
      { id: 'distrib-train', group: 'Distributed training', title: 'Data / model parallelism, all-reduce' },
      { id: 'gpu-basics', group: 'Hardware', title: 'GPU fundamentals: memory, kernels, batch sizing' },
      { id: 'feature-store', group: 'Data', title: 'Feature stores: Feast / online vs offline' },
      { id: 'sql-warehouse', group: 'Data', title: 'Warehouse SQL: window funcs, CTE, joins' },
      { id: 'sd-recsys', group: 'System Design', title: 'Recommender system from scratch' },
      { id: 'sd-llm-infra', group: 'System Design', title: 'LLM serving infra: KV cache, batching' },
      { id: 'classical-ml', group: 'Modeling basics', title: 'Classical ML: trees, regression, regularization' },
      { id: 'dl-fundamentals', group: 'Modeling basics', title: 'Deep learning fundamentals (backprop, optimizers)' },
      { id: 'transformer', group: 'Modeling basics', title: 'Transformer architecture' },
      { id: 'behavior-leadership', group: 'Behavioural', title: 'Cross-team coordination stories' },
    ],
  },
  {
    id: 'backend-junior-middle',
    title: 'Backend junior → middle',
    blurb: 'Базовые алгоритмы · SQL · API design · Тестирование',
    nodes: [
      { id: 'algo-arrays', group: 'Algorithms', title: 'Arrays, hash maps, two-pointer' },
      { id: 'algo-strings', group: 'Algorithms', title: 'Strings, sliding window' },
      { id: 'algo-recursion', group: 'Algorithms', title: 'Recursion, basic backtracking' },
      { id: 'sql-basics', group: 'SQL', title: 'JOINs, GROUP BY, basic indexing' },
      { id: 'api-rest', group: 'API design', title: 'REST conventions, status codes, idempotency' },
      { id: 'http-basics', group: 'Networking', title: 'HTTP / DNS / TCP basics' },
      { id: 'testing-unit', group: 'Testing', title: 'Unit + integration testing' },
      { id: 'testing-mocking', group: 'Testing', title: 'Mocking strategies' },
      { id: 'git-basics', group: 'Tooling', title: 'Git: rebase, branching strategies' },
      { id: 'docker-basics', group: 'Tooling', title: 'Docker / Compose basics' },
      { id: 'behavior-tellme', group: 'Behavioural', title: 'STAR framework: tell-me-about-a-time' },
    ],
  },
]

export function findPreset(id: string): PathPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}
