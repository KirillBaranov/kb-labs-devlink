import type { DevlinkState, DepEdge } from './types';

// Упрощённый граф: набор ребер уже есть в state.
// Оставляем хелперы для фильтрации и топологического порядка.

export function outgoing(state: DevlinkState, name: string): DepEdge[] {
  return state.deps.filter(d => d.from === name);
}

export function incoming(state: DevlinkState, name: string): DepEdge[] {
  return state.deps.filter(d => d.to === name);
}

export function topoOrder(state: DevlinkState): string[] {
  // простой Kahn без типов deps
  const names = new Set(state.packages.map(p => p.name));
  const inCount = new Map<string, number>();
  names.forEach(n => inCount.set(n, 0));
  state.deps.forEach(d => {
    if (names.has(d.to)) { inCount.set(d.to, (inCount.get(d.to) || 0) + 1); }
  });
  const q: string[] = [];
  inCount.forEach((c, n) => { if (c === 0) { q.push(n); } });

  const res: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    res.push(n);
    state.deps.forEach(d => {
      if (d.from === n) {
        const c = (inCount.get(d.to) || 0) - 1;
        inCount.set(d.to, c);
        if (c === 0) { q.push(d.to); }
      }
    });
  }
  // если цикл — часть узлов не попала; возвращаем что есть
  return res;
}