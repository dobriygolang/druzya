import { http, HttpResponse } from 'msw';

const services = [
  { name: 'PostgreSQL', slug: 'postgres', status: 'operational', uptime30d: '99.99%', latencyMs: 7 },
  { name: 'Redis', slug: 'redis', status: 'operational', uptime30d: '99.98%', latencyMs: 2 },
  { name: 'Web App', slug: 'web', status: 'operational', uptime30d: '99.95%' },
  { name: 'REST API', slug: 'api', status: 'operational', uptime30d: '99.96%' },
  { name: 'WebSocket', slug: 'ws', status: 'degraded', uptime30d: '99.50%' },
  { name: 'MinIO', slug: 'minio', status: 'operational', uptime30d: '100.00%' },
  { name: 'Judge0', slug: 'judge0', status: 'operational', uptime30d: '99.90%' },
  { name: 'OpenRouter', slug: 'openrouter', status: 'operational', uptime30d: '99.97%' },
];

function fakeBuckets(slug, days) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    let status = 'operational';
    if (slug === 'ws' && i < 3) status = 'degraded';
    if (slug === 'judge0' && i === 12) status = 'down';
    out.push({ day, status });
  }
  return out;
}

export const statusHandlers = [
  http.get('/api/v1/status', () =>
    HttpResponse.json({
      overallStatus: 'degraded',
      uptime90d: '99.92%',
      services,
      incidents: [
        {
          id: 'inc-001',
          title: 'WebSocket задержки',
          description: 'Часть соединений долго отдают первый pong.',
          severity: 'minor',
          startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
          endedAt: null,
          affectedServices: ['ws'],
        },
      ],
      generatedAt: new Date().toISOString(),
    }),
  ),
  http.get('/api/v1/status/history', ({ request }) => {
    const url = new URL(request.url);
    const slug = url.searchParams.get('service') || '';
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || '30')));
    return HttpResponse.json({ service: slug, days, buckets: fakeBuckets(slug, days) });
  }),
];
