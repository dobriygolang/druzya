// ============ AI Mock Session ============
const mockCode = `package main

import "fmt"

// Two Sum — return indices of two numbers that add up to target
func twoSum(nums []int, target int) []int {
    seen := make(map[int]int, len(nums))
    for i, n := range nums {
        if j, ok := seen[target-n]; ok {
            return []int{j, i}
        }
        seen[n] = i
    }
    return nil
}

func main() {
    fmt.Println(twoSum([]int{2, 7, 11, 15}, 9))
}`;

function SectionPills({ sections }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {sections.map((s, i) => {
        const bg = s.state === 'done' ? 'rgba(99,153,34,0.18)'
                 : s.state === 'active' ? 'rgba(127,119,221,0.18)'
                 : 'var(--bg-inset)';
        const bd = s.state === 'done' ? 'var(--sec-sql-accent)'
                 : s.state === 'active' ? 'var(--sec-sd-accent)'
                 : 'var(--gold-faint)';
        const c = s.state === 'done' ? 'var(--sec-sql-accent)'
                : s.state === 'active' ? 'var(--sec-sd-accent)'
                : 'var(--text-dim)';
        return (
          <div key={i} style={{
            padding: '5px 12px', border: `1px solid ${bd}`, background: bg, color: c,
            fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.18em',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <span>{s.state === 'done' ? '✓' : s.state === 'active' ? '◆' : '◇'}</span>
            {s.name}
          </div>
        );
      })}
    </div>
  );
}

function CodeEditor({ code, highlightLine, compact }) {
  const lines = code.split('\n');
  return (
    <div style={{ background: 'var(--bg-inset)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', background: 'var(--bg-base)', borderBottom: '1px solid var(--gold-faint)', fontFamily: 'var(--font-code)', fontSize: 10 }}>
        <div style={{ padding: '8px 16px', background: 'var(--bg-inset)', color: 'var(--gold-bright)', borderRight: '1px solid var(--gold-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--sec-go-accent)' }}>◈</span>solution.go
        </div>
        <div style={{ padding: '8px 16px', color: 'var(--text-dim)' }}>tests.go</div>
        <div className="grow" />
        <div style={{ padding: '8px 16px', color: 'var(--text-mid)' }}>Go 1.22 · UTF-8 · LF</div>
      </div>
      {/* Code */}
      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'var(--font-code)', fontSize: compact ? 11 : 12.5, lineHeight: 1.7, position: 'relative' }}>
        {lines.map((line, i) => {
          const active = i + 1 === highlightLine;
          return (
            <div key={i} style={{ display: 'flex', background: active ? 'rgba(200,169,110,0.05)' : 'transparent' }}>
              <span style={{
                width: 48, textAlign: 'right', paddingRight: 14,
                color: active ? 'var(--gold)' : 'var(--gold-dim)',
                borderRight: '1px solid var(--gold-faint)', flexShrink: 0,
                userSelect: 'none'
              }}>{i + 1}</span>
              <span style={{ paddingLeft: 16, whiteSpace: 'pre', color: 'var(--text-bright)' }}>
                {syntaxGo(line)}
                {active && <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--gold-bright)', verticalAlign: 'text-bottom', marginLeft: 1, animation: 'blink 1s steps(1) infinite' }} />}
              </span>
            </div>
          );
        })}
      </div>
      {/* status bar */}
      <div style={{ display: 'flex', background: 'var(--bg-base)', borderTop: '1px solid var(--gold-faint)', padding: '6px 14px', fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-mid)', gap: 20 }}>
        <span style={{ color: 'var(--sec-sql-accent)' }}>● tests: 2/3 passing</span>
        <span>Ln {highlightLine || 14}, Col 32</span>
        <div className="grow" />
        <span>⚗ stress: moderate</span>
      </div>
    </div>
  );
}

function syntaxGo(line) {
  // minimal syntax coloring
  const kw = /(package|import|func|for|range|if|ok|return|make|var|const|type|struct|interface|map)/g;
  const str = /"([^"]*)"/g;
  const com = /(\/\/.*)$/;

  let parts = [line];
  const tokenize = (arr) => arr.flatMap(seg => {
    if (typeof seg !== 'string') return [seg];
    const out = [];
    let last = 0;
    // comments first
    const cm = seg.match(com);
    if (cm) {
      const idx = seg.indexOf(cm[0]);
      out.push(seg.slice(0, idx));
      out.push({ c: 'var(--text-dim)', t: cm[0] });
      return out;
    }
    seg.replace(kw, (m, _, i) => {
      if (i > last) out.push(seg.slice(last, i));
      out.push({ c: 'var(--sec-sd-accent)', t: m });
      last = i + m.length;
    });
    if (last < seg.length) out.push(seg.slice(last));
    return out;
  });

  parts = tokenize(parts);
  parts = parts.flatMap(seg => {
    if (typeof seg !== 'string') return [seg];
    const out = [];
    let last = 0;
    seg.replace(str, (m, _, i) => {
      if (i > last) out.push(seg.slice(last, i));
      out.push({ c: 'var(--sec-sql-accent)', t: m });
      last = i + m.length;
    });
    if (last < seg.length) out.push(seg.slice(last));
    return out;
  });

  return parts.map((p, i) => typeof p === 'string'
    ? <span key={i}>{p}</span>
    : <span key={i} style={{ color: p.c }}>{p.t}</span>
  );
}

function StressMeter({ label, pct, color = 'var(--gold)' }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: '0.2em', color: 'var(--text-mid)', marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color }}>{pct}%</span>
      </div>
      <div className="bar"><div className="fill" style={{ width: pct + '%', background: color }} /></div>
    </div>
  );
}

function AIMockScreen() {
  const sections = [
    { name: 'WARMUP', state: 'done' },
    { name: 'LEETCODE', state: 'active' },
    { name: 'SQL', state: 'locked' },
    { name: 'SYSDESIGN', state: 'locked' },
    { name: 'BEHAVIORAL', state: 'locked' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--gold-faint)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.15em' }}>
          <span style={{ color: 'var(--text-mid)' }}>OZON</span>
          <span style={{ color: 'var(--gold-dim)' }}>›</span>
          <span style={{ color: 'var(--text-mid)' }}>LEETCODE</span>
          <span style={{ color: 'var(--gold-dim)' }}>›</span>
          <span className="gold-bright">TWO SUM</span>
          <span className="badge badge-hard" style={{ marginLeft: 10 }}>HARD</span>
        </div>

        <SectionPills sections={sections} />

        <div className="grow" />

        {/* timer in gold frame */}
        <div className="card corners" style={{ padding: '6px 18px', background: 'var(--bg-inset)' }}>
          <Corners />
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>REMAINING</div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 20, color: 'var(--gold-bright)', letterSpacing: '0.1em' }}>32:14</div>
        </div>

        <button className="btn btn-sm">⊘&nbsp;Abandon</button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Editor — 60% */}
        <div style={{ flex: 0.6, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--gold-faint)' }}>
          {/* Task card */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
            <div className="heraldic" style={{ fontSize: 14, color: 'var(--gold-bright)' }}>Two Sum — Trial I</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>
              Given an array of integers <span className="mono gold">nums</span> and an integer <span className="mono gold">target</span>, return indices of the two numbers such that they add up to target. Assume exactly one solution exists.
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <CodeEditor code={mockCode} highlightLine={14} />
          </div>
        </div>

        {/* AI panel — 40% */}
        <div style={{ flex: 0.4, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', minWidth: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--gold-faint)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, background: 'var(--sec-sql-accent)', borderRadius: '50%' }} />
            <span className="heraldic" style={{ fontSize: 12, color: 'var(--gold-bright)' }}>AI Interviewer</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.2em', color: 'var(--text-mid)' }}>· GPT-4O · STRICT</span>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* neutral — question */}
            <div style={{ background: '#13161e', border: '1px solid #1e2130', padding: 12, position: 'relative' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.25em', color: 'var(--text-dim)', marginBottom: 6 }}>INTERVIEWER · 00:02:14</div>
              <div style={{ fontSize: 12, color: 'var(--text-bright)', lineHeight: 1.55 }}>
                Let's start. Given an array <span className="mono gold">nums</span> and <span className="mono gold">target</span>, return indices of two numbers that sum to target. Walk me through your approach before writing code.
              </div>
            </div>

            <div style={{ background: '#0a0c10', border: '1px solid var(--gold-faint)', padding: 12 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.25em', color: 'var(--gold)', marginBottom: 6 }}>YOU · 00:02:41</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.55 }}>
                Brute force is O(n²). I'll use a hash map — single pass, O(n) time, O(n) space.
              </div>
            </div>

            {/* warn */}
            <div style={{ background: 'var(--warn-fill)', border: '1px solid var(--warn-border)', padding: 12 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.25em', color: 'var(--warn-text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span>INTERVENTION · 00:08:02
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-bright)', lineHeight: 1.55 }}>
                I notice you've paused for 94 seconds. Talk me through what you're considering — silence doesn't help me evaluate your reasoning.
              </div>
            </div>

            <div style={{ background: '#13161e', border: '1px solid #1e2130', padding: 12 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.25em', color: 'var(--text-dim)', marginBottom: 6 }}>INTERVIEWER · 00:11:17</div>
              <div style={{ fontSize: 12, color: 'var(--text-bright)', lineHeight: 1.55 }}>
                Good — your implementation looks correct. What happens if the array contains duplicates, e.g. <span className="mono gold">[3, 3]</span> with <span className="mono gold">target = 6</span>?
              </div>
            </div>

            {/* stop */}
            <div style={{ background: 'var(--stop-fill)', border: '1px solid var(--stop-border)', padding: 12 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.25em', color: 'var(--stop-text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⊘</span>HALT · 00:14:40
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-bright)', lineHeight: 1.55 }}>
                Before you submit — your code writes <span className="mono gold">seen[n] = i</span> before checking. Trace through <span className="mono gold">[3, 3]</span> on paper.
              </div>
            </div>
          </div>

          {/* Stress meters */}
          <div style={{ padding: 16, borderTop: '1px solid var(--gold-faint)', background: 'var(--bg-inset)' }}>
            <Divider style={{ fontSize: 8, marginBottom: 12 }}>Stress Telemetry</Divider>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <StressMeter label="PAUSES" pct={62} color="var(--warn-text)" />
              <StressMeter label="BACKSPACE BURSTS" pct={34} color="var(--gold)" />
              <StressMeter label="CHAOTIC EDITS" pct={18} color="var(--sec-sql-accent)" />
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: 12, borderTop: '1px solid var(--gold-faint)', display: 'flex', gap: 8 }}>
            <input placeholder="Reply to the interviewer..." style={{
              flex: 1, background: 'var(--bg-inset)', border: '1px solid var(--gold-faint)',
              padding: '9px 12px', color: 'var(--text-bright)', outline: 'none', fontSize: 12
            }} />
            <button className="btn btn-sm btn-primary">SEND</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ AI-Native Round ============
function AINativeScreen() {
  const sections = [
    { name: 'BRIEF', state: 'done' },
    { name: 'PROMPT', state: 'done' },
    { name: 'BUILD', state: 'active' },
    { name: 'VERIFY', state: 'locked' },
    { name: 'DELIVER', state: 'locked' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--gold-faint)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.15em' }}>
          <span style={{ color: 'var(--text-mid)' }}>YANDEX</span>
          <span style={{ color: 'var(--gold-dim)' }}>›</span>
          <span style={{ color: 'var(--text-mid)' }}>BACKEND</span>
          <span style={{ color: 'var(--gold-dim)' }}>›</span>
          <span className="gold-bright">RATE LIMITER</span>
          <span style={{
            marginLeft: 10, padding: '3px 10px',
            border: '1px solid var(--gold)', background: 'rgba(127,119,221,0.12)',
            color: 'var(--sec-sd-accent)', fontSize: 9, letterSpacing: '0.25em', fontFamily: 'var(--font-display)'
          }}>⚜ AI ALLOWED</span>
        </div>

        <SectionPills sections={sections} />

        <div className="grow" />

        <div className="card corners" style={{ padding: '6px 18px', background: 'var(--bg-inset)' }}>
          <Corners />
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>REMAINING</div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 20, color: 'var(--gold-bright)' }}>24:08</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Editor 55% */}
        <div style={{ flex: 0.55, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--gold-faint)' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
            <div className="heraldic" style={{ fontSize: 13, color: 'var(--gold-bright)' }}>Token Bucket Rate Limiter</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>
              Implement a thread-safe token bucket with refill. You may use an AI assistant — your <span className="gold-bright">interaction</span> is what's scored.
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CodeEditor code={`package ratelimit

import (
    "sync"
    "time"
)

type Bucket struct {
    capacity   int
    tokens     int
    refillRate time.Duration
    lastRefill time.Time
    mu         sync.Mutex
}

func New(capacity int, rate time.Duration) *Bucket {
    return &Bucket{
        capacity:   capacity,
        tokens:     capacity,
        refillRate: rate,
        lastRefill: time.Now(),
    }
}

// Allow returns true if a token is available.
func (b *Bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(b.lastRefill)
    refill := int(elapsed / b.refillRate)
    if refill > 0 {
        b.tokens = min(b.capacity, b.tokens+refill)
        b.lastRefill = now
    }`} highlightLine={28} />
          </div>
        </div>

        {/* Right panel — 3 zones */}
        <div style={{ flex: 0.45, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', minWidth: 0 }}>
          {/* AI assistant zone */}
          <div style={{ flex: '0 0 32%', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--gold-faint)', minHeight: 0 }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gold-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--sec-sd-accent)' }}>⚜</span>
              <span className="heraldic" style={{ fontSize: 11, color: 'var(--gold-bright)' }}>AI Assistant</span>
              <div className="grow" />
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--text-mid)' }}>claude-sonnet-4</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
              <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-code)', fontSize: 10 }}>&gt; explain sync.Mutex vs RWMutex for Allow()</div>
              <div style={{ background: 'rgba(127,119,221,0.08)', borderLeft: '2px solid var(--sec-sd-accent)', padding: '8px 10px', color: 'var(--text-bright)', lineHeight: 1.5 }}>
                For Allow() you always write (decrement tokens), so RWMutex gives no benefit. Stick with sync.Mutex — lower overhead on the hot path.
              </div>
              <input placeholder="Ask the assistant..." style={{
                background: 'var(--bg-inset)', border: '1px solid var(--gold-faint)', padding: '8px 10px',
                color: 'var(--text-bright)', outline: 'none', fontSize: 11, fontFamily: 'var(--font-code)'
              }} />
            </div>
          </div>

          {/* Provenance Graph */}
          <div style={{ flex: '0 0 34%', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--gold-faint)', minHeight: 0 }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gold-faint)' }}>
              <span className="heraldic" style={{ fontSize: 11, color: 'var(--gold-bright)' }}>Provenance Graph</span>
            </div>
            <div style={{ flex: 1, padding: 14, overflow: 'auto' }}>
              <ProvenanceTimeline />
            </div>
          </div>

          {/* Score meters */}
          <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
            <Divider style={{ fontSize: 8, marginBottom: 14 }}>Live Score</Divider>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ScoreRing label="CONTEXT" pct={78} color="var(--sec-sd-accent)" desc="Prompts are specific" />
              <ScoreRing label="VERIFICATION" pct={54} color="var(--gold)" desc="Run the tests before you ship" />
              <ScoreRing label="JUDGMENT" pct={82} color="var(--sec-sql-accent)" desc="Caught 2 of 2 hallucinations" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvenanceTimeline() {
  const items = [
    { kind: 'ai', label: 'AI draft · Bucket struct', t: '00:02' },
    { kind: 'human', label: 'Human revision · added mu', t: '00:04' },
    { kind: 'accepted', label: 'Accepted', t: '00:05' },
    { kind: 'ai', label: 'AI suggested RWMutex', t: '00:08' },
    { kind: 'rejected', label: 'Rejected — wrong tool', t: '00:09' },
    { kind: 'human', label: 'Manual: refill logic', t: '00:12' },
    { kind: 'ai', label: 'AI draft · test cases', t: '00:14' },
  ];
  const colorFor = k => ({
    ai: 'var(--sec-sd-accent)', human: 'var(--gold)',
    accepted: 'var(--sec-sql-accent)', rejected: 'var(--stop-text)'
  })[k];
  const glyphFor = k => ({ ai: '⚜', human: '◈', accepted: '✓', rejected: '⊘' })[k];

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 11, top: 4, bottom: 4, width: 1, background: 'var(--gold-faint)' }} />
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
          <div style={{
            width: 22, height: 22, flexShrink: 0,
            border: `1px solid ${colorFor(it.kind)}`,
            background: 'var(--bg-inset)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colorFor(it.kind), fontSize: 11
          }}>{glyphFor(it.kind)}</div>
          <div style={{ flex: 1, fontSize: 10.5, color: 'var(--text-bright)' }}>{it.label}</div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--text-mid)' }}>{it.t}</div>
        </div>
      ))}
    </div>
  );
}

function ScoreRing({ label, pct, color, desc }) {
  const C = 2 * Math.PI * 22;
  const off = C - (pct / 100) * C;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="22" fill="none" stroke="var(--gold-faint)" strokeWidth="3" />
        <circle cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 28 28)" strokeLinecap="butt" />
        <text x="28" y="33" textAnchor="middle" fill={color} fontFamily="var(--font-code)" fontSize="13" fontWeight="700">{pct}</text>
      </svg>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.22em', color: 'var(--gold-bright)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

Object.assign(window, { AIMockScreen, AINativeScreen });
