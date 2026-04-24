// Whiteboard — hand-drawn-looking architectural sketch with an AI critic
// panel. The SVG content is a placeholder; the real editor (tldraw) is a
// Phase 5c task. Keeping the placeholder around lets us verify the
// critic-panel toggle and the tool-row positioning survive the port.
import { useState } from 'react';

import { Icon } from '../components/primitives/Icon';

export function WhiteboardPage() {
  const [tool, setTool] = useState('V');
  const [critique, setCritique] = useState(false);

  return (
    <div className="fadein" style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0 }}
      >
        <g transform="translate(560 360)">
          <rect
            width="200"
            height="110"
            rx="6"
            fill="rgba(255,255,255,0.025)"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="1.3"
          />
          <text x="16" y="32" fill="rgba(255,255,255,0.95)" fontFamily="JetBrains Mono" fontSize="15">
            api
          </text>
          <text x="16" y="56" fill="rgba(255,255,255,0.45)" fontFamily="Inter" fontSize="12">
            Go · 3 replicas
          </text>
          <text x="16" y="84" fill="rgba(255,255,255,0.4)" fontFamily="JetBrains Mono" fontSize="11">
            /v1/*
          </text>
        </g>
        <g transform="translate(920 290)">
          <circle
            cx="70"
            cy="70"
            r="66"
            fill="rgba(255,255,255,0.02)"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="1.3"
          />
          <text
            x="70"
            y="66"
            textAnchor="middle"
            fill="rgba(255,255,255,0.95)"
            fontFamily="JetBrains Mono"
            fontSize="15"
          >
            postgres
          </text>
          <text
            x="70"
            y="86"
            textAnchor="middle"
            fill="rgba(255,255,255,0.4)"
            fontFamily="Inter"
            fontSize="12"
          >
            primary + RR
          </text>
        </g>
        <g transform="translate(920 510)">
          <circle
            cx="70"
            cy="70"
            r="66"
            fill="rgba(255,255,255,0.02)"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="1.3"
          />
          <text
            x="70"
            y="66"
            textAnchor="middle"
            fill="rgba(255,255,255,0.95)"
            fontFamily="JetBrains Mono"
            fontSize="15"
          >
            s3
          </text>
          <text
            x="70"
            y="86"
            textAnchor="middle"
            fill="rgba(255,255,255,0.4)"
            fontFamily="Inter"
            fontSize="12"
          >
            blobs
          </text>
        </g>
        <g transform="translate(320 390)">
          <rect
            width="150"
            height="70"
            rx="6"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          <text x="16" y="30" fill="rgba(255,255,255,0.7)" fontFamily="JetBrains Mono" fontSize="13">
            client
          </text>
          <text x="16" y="52" fill="rgba(255,255,255,0.4)" fontFamily="Inter" fontSize="11">
            web / ios
          </text>
        </g>
        <defs>
          <marker
            id="ahw"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.8)" />
          </marker>
        </defs>
        <path
          d="M470,422 L560,415"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="1.2"
          fill="none"
          markerEnd="url(#ahw)"
        />
        <path
          d="M760,385 L920,355"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="1.2"
          fill="none"
          markerEnd="url(#ahw)"
        />
        <path
          d="M760,440 L920,575"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="1.2"
          fill="none"
          markerEnd="url(#ahw)"
        />
      </svg>

      {critique && (
        <div
          className="fadein"
          style={{
            position: 'absolute',
            top: 120,
            right: 80,
            width: 440,
            fontSize: 13,
            color: 'var(--ink-90)',
            lineHeight: 1.75,
            letterSpacing: '-0.005em',
          }}
        >
          <div
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 16 }}
          >
            SENIOR REVIEW
          </div>
          <p style={{ margin: '0 0 14px' }}>
            Strong: clear data separation — relational in Postgres, blobs in S3. Right default.
          </p>
          <p style={{ margin: '0 0 14px', color: 'var(--ink-60)' }}>
            Concern: no caching layer between API and Postgres. Your read traffic will hammer the
            primary.
          </p>
          <p style={{ margin: '0 0 14px', color: 'var(--ink-60)' }}>
            Missing: retry policy with jittered backoff. Dead-letter queue for async writes to S3.
            Observability plane is absent.
          </p>
        </div>
      )}

      <div style={{ position: 'absolute', top: 86, right: 32 }}>
        <button
          onClick={() => setCritique((c) => !c)}
          className="focus-ring"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 13px',
            borderRadius: 999,
            background: critique ? '#fff' : 'rgba(255,255,255,0.06)',
            color: critique ? '#000' : 'var(--ink)',
            fontSize: 12.5,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Icon name="sparkle" size={12} /> ⌘E critique
        </button>
      </div>

      {/* Tool row — positioned ABOVE the persistent timer dock. */}
      <div
        style={{
          position: 'absolute',
          bottom: 92,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 4,
          padding: 6,
          borderRadius: 999,
          background: 'rgba(10,10,10,0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(18px)',
        }}
      >
        {['V', 'R', 'O', 'L', 'T', 'E'].map((k) => {
          const active = tool === k;
          return (
            <button
              key={k}
              onClick={() => setTool(k)}
              className="focus-ring mono"
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink-60)',
              }}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
