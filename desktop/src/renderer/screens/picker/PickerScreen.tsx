// PickerScreen — standalone floating dropdown window rendered by main's
// 'picker' BrowserWindow. Loaded as `#/picker?kind=persona|model` so the
// same window asset can serve both Compact pickers without growing the
// Compact window itself.
//
// State flow: this screen lives in a separate renderer process, so it
// cannot share Zustand memory with the Compact renderer directly.
// Instead, each store has a `bootstrap()` that loads from main (IPC) and
// subscribes to the same cross-window events Compact listens to — so
// selecting a model/persona here writes through IPC, main broadcasts the
// change, and Compact's store updates in response.

import { useEffect, useMemo, useState } from 'react';

import { ModelDropdown, type ModelDropdownItem } from '../../components/d9/ModelDropdown';
import { PersonaDropdown, type PersonaDropdownItem } from '../../components/d9/PersonaDropdown';
import { useConfig } from '../../hooks/use-config';
import { usePersonaStore } from '../../stores/persona';
import { useSelectedModelStore } from '../../stores/selected-model';

type Kind = 'persona' | 'model';

function readKind(): Kind {
  const m = /kind=(persona|model)/.exec(window.location.hash);
  return (m?.[1] as Kind) ?? 'persona';
}

export function PickerScreen() {
  const [kind, setKind] = useState<Kind>(() => readKind());

  useEffect(() => {
    const onHash = () => setKind(readKind());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div
      className="d9-root"
      style={{
        width: '100%',
        height: '100%',
        padding: 4,
        background: 'transparent',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
      }}
    >
      {kind === 'persona' ? <PersonaContent /> : <ModelContent />}
    </div>
  );
}

function close() {
  void window.druz9.windows.hidePicker();
}

function PersonaContent() {
  const activePersona = usePersonaStore((s) => s.active);
  const list = usePersonaStore((s) => s.list);
  const setActive = usePersonaStore((s) => s.setActive);
  const bootstrap = usePersonaStore((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);

  const items: PersonaDropdownItem[] = useMemo(
    () =>
      list.slice(0, 9).map((p, i) => ({
        id: p.id,
        label: p.label,
        hint: p.hint,
        hotkey: String(i + 1),
        background: p.brand_gradient,
      })),
    [list],
  );

  return (
    <PersonaDropdown
      items={items}
      activeId={activePersona.id}
      onSelect={(id) => {
        setActive(id);
        close();
      }}
      onClose={close}
      style={{ width: '100%' }}
    />
  );
}

function ModelContent() {
  const { config } = useConfig();
  const selected = useSelectedModelStore((s) => s.modelId);
  const setModel = useSelectedModelStore((s) => s.setModel);
  const bootstrap = useSelectedModelStore((s) => s.bootstrap);
  useEffect(() => bootstrap(), [bootstrap]);

  const items: ModelDropdownItem[] = useMemo(
    () =>
      (config?.models ?? []).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        providerName: m.providerName,
        latencyMs: m.typicalLatencyMs,
        availableOnCurrentPlan: m.availableOnCurrentPlan,
        supportsVision: m.supportsVision,
      })),
    [config],
  );

  const activeId = selected || config?.defaultModelId || '';

  return (
    <ModelDropdown
      items={items}
      activeId={activeId}
      onSelect={(id) => {
        setModel(id);
        close();
      }}
      onClose={close}
      onManage={() => {
        void window.druz9.ui.openProviderPicker();
        close();
      }}
      style={{ width: '100%' }}
    />
  );
}
