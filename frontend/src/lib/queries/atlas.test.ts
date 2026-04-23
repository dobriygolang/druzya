import { describe, expect, it } from 'vitest'
import { countTotal, countUnlocked, nodesBySection, type Atlas } from './atlas'

function fixture(): Atlas {
  return {
    center_node: 'class_core',
    nodes: [
      {
        key: 'class_core',
        title: 'Ядро класса',
        section: 'algorithms',
        kind: 'keystone',
        progress: 100,
        unlocked: true,
        decaying: false,
        description: '',
      },
      {
        key: 'algo_basics',
        title: 'Алгоритмы: основы',
        section: 'algorithms',
        kind: 'normal',
        progress: 50,
        unlocked: false,
        decaying: false,
        description: '',
      },
      {
        key: 'sql_basics',
        title: 'SQL: основы',
        section: 'sql',
        kind: 'normal',
        progress: 0,
        unlocked: false,
        decaying: false,
        description: '',
      },
    ],
    edges: [
      { from: 'class_core', to: 'algo_basics' },
      { from: 'class_core', to: 'sql_basics' },
    ],
  }
}

describe('countUnlocked / countTotal', () => {
  it('считает только unlocked-узлы', () => {
    expect(countUnlocked(fixture())).toBe(1)
    expect(countTotal(fixture())).toBe(3)
  })

  it('возвращает 0 для undefined', () => {
    expect(countUnlocked(undefined)).toBe(0)
    expect(countTotal(undefined)).toBe(0)
  })
})

describe('nodesBySection', () => {
  it('группирует по полю section', () => {
    const groups = nodesBySection(fixture())
    expect(Object.keys(groups).sort()).toEqual(['algorithms', 'sql'])
    expect(groups.algorithms).toHaveLength(2)
    expect(groups.sql).toHaveLength(1)
  })

  it('возвращает пустой объект для undefined', () => {
    expect(nodesBySection(undefined)).toEqual({})
  })
})
