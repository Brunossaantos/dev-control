import type { Preferences, Dashboard, Plan, Reading, AlertMemory, Palette, Step } from '../types'

export const PALETTES: Palette[] = [
  { id: 'ocean', label: 'Oceano', accent: '#38BDF8', background: '#0C1826', foreground: '#E2E8F0' },
  { id: 'forest', label: 'Floresta', accent: '#4ADE80', background: '#102019', foreground: '#E0F2E7' },
  { id: 'violet', label: 'Violeta', accent: '#C084FC', background: '#1C142B', foreground: '#F3E8FF' },
  { id: 'ember', label: 'Brasa', accent: '#FB923C', background: '#271A14', foreground: '#FFF0E5' },
  { id: 'paper', label: 'Papel', accent: '#0369A1', background: '#F8FAFC', foreground: '#1E293B' },
  { id: 'graphite', label: 'Grafite', accent: '#94A3B8', background: '#17191D', foreground: '#F1F5F9' },
]
export function defaults(): Preferences {
  return { channels: { terminal: true, audio: false, desktop: false },
    events: { context: true, account: true, response: false, failures: true, input: true },
    levels: [70, 85, 95], interval: 30, cooldown: 60, focus: false, details: false,
    effort: null, workerEffort: false, model: null, palette: null,
    accent: '#38BDF8', background: '#0C1826', foreground: '#E2E8F0' }
}
export function blank(): Dashboard {
  return { screen: null, prefs: defaults(), usage: null, root: '', profile: 'session', error: '', delivery: '',
    workers: [], workerError: '', selected: null, filter: '', plan: null, permission: null, busy: null, clock: 0, windows: null, lastReply: null }
}
export function bands(input: string): number[] | null {
  const pieces = input.split(',').map(s => s.trim())
  if (!pieces.length || pieces.length > 6 || pieces.some(s => !/^\d{1,3}$/.test(s))) return null
  const result = [...new Set(pieces.map(Number))].sort((a, b) => a - b)
  return result.every(n => n > 0 && n <= 100) ? result : null
}
export function hex(s: unknown): s is string { return typeof s === 'string' && /^#[\da-f]{6}$/i.test(s) }
export function preferences(raw: unknown): Preferences {
  const p = defaults()
  if (!raw || typeof raw !== 'object') return p
  const x = raw as Record<string, unknown>
  for (const group of ['channels', 'events'] as const) {
    const source = x[group]
    if (source && typeof source === 'object') for (const k of Object.keys(p[group])) {
      const value = (source as Record<string, unknown>)[k]
      if (typeof value === 'boolean') (p[group] as Record<string, boolean>)[k] = value
    }
  }
  if (Array.isArray(x.levels)) p.levels = bands(x.levels.join(',')) ?? p.levels
  for (const [key, min, max] of [['interval', 15, 300], ['cooldown', 5, 600]] as const) {
    if (typeof x[key] === 'number' && Number.isFinite(x[key])) p[key] = Math.min(max, Math.max(min, Math.trunc(x[key])))
  }
  for (const key of ['focus', 'details', 'workerEffort'] as const) if (typeof x[key] === 'boolean') p[key] = x[key]
  if (typeof x.effort === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(x.effort)) p.effort = x.effort as Preferences['effort']
  if (typeof x.model === 'string' && x.model.length <= 120) p.model = x.model
  if (typeof x.palette === 'string' && (x.palette === 'custom' || PALETTES.some(v => v.id === x.palette))) p.palette = x.palette
  for (const key of ['accent', 'background', 'foreground'] as const) if (hex(x[key])) p[key] = x[key]
  return p
}
export function projectKey(path: string): string {
  const p = path.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
  return /^[A-Z]:\//i.test(p) ? p.toLowerCase() : p
}
export function alerts(readings: Reading[], old: AlertMemory, levels: number[]): { memory: AlertMemory; messages: string[] } {
  const memory: AlertMemory = { ...old }; const messages: string[] = []
  for (const r of readings) {
    if (r.value === null || !Number.isFinite(r.value) || r.value < 0) continue
    const cycle = `${r.reset ?? 'unknown'}|${levels.join('/')}`
    const prior = old[r.key]
    let previousBand = prior?.band ?? -1
    if (!prior || prior.cycle !== cycle || (r.key === 'context' && prior.value - r.value >= 10) ||
      (r.key !== 'context' && prior.value >= 70 && r.value < 20)) previousBand = -1
    let currentBand = -1
    for (let i = 0; i < levels.length; i++) if (r.value >= levels[i]) currentBand = i
    if (currentBand > previousBand) messages.push(`${label(r.key)}: ${Math.round(r.value)}% (faixa ${levels[currentBand]}%)`)
    memory[r.key] = { cycle, value: r.value, band: Math.max(currentBand, previousBand) }
  }
  return { memory, messages }
}
export function percentage(plan: Plan): number | null {
  return plan.steps.length ? Math.floor(100 * plan.steps.filter(s => s.state === 'done').length / plan.steps.length) : null
}
export function endPlan(plan: Plan, reason: string, at: number): Plan {
  let state: Plan['state'] = 'waiting'
  if (reason === 'aborted') state = 'interrupted'
  else if (reason === 'error' || reason === 'refusal' || plan.steps.some(s => s.state === 'error') || plan.state === 'error') state = 'error'
  else if (plan.state === 'waiting' || plan.state === 'interrupted') state = plan.state
  else if (plan.steps.length && plan.steps.every(s => s.state === 'done')) state = 'done'
  return { ...plan, state, stopped: at }
}
export function steps(input: unknown): Step[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, 100).flatMap(s => {
    if (!s || typeof s !== 'object' || typeof s.title !== 'string') return []
    return [{ ...(typeof s.id === 'string' ? { id: s.id.slice(0, 100) } : {}), title: s.title.slice(0, 300), state: ['pending', 'active', 'done', 'error', 'blocked'].includes(s.state) ? s.state : 'pending' }]
  })
}
export function failure(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return p.interrupted === true || p.isError === true || typeof p.exitCode === 'number' && p.exitCode !== 0
}
export function numberLabel(n: number | null): string {
  if (n === null) return 'n/d'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
}
export function remaining(reset: string | null, now: number): string {
  if (!reset || !Number.isFinite(Date.parse(reset))) return 'não informado'
  const minutes = Math.ceil(Math.max(0, Date.parse(reset) - now) / 60000)
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h` : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}
export function shade(p: Palette) {
  const rgb = [1, 3, 5].map(i => parseInt(p.background.slice(i, i + 2), 16))
  return { name: `Dev Control ${p.label}`, base: rgb.reduce((a, b) => a + b, 0) > 500 ? 'light' : 'dark',
    overrides: { claude: p.accent, text: p.foreground, inactive: p.accent, userMessageBackground: p.background } }
}
// A análise léxica remove comentários JSONC sem alterar o conteúdo das strings.
export function jsonc(input: string): unknown {
  let text = ''; let quoted = false; let escaped = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i], next = input[i + 1]
    if (quoted) { text += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue }
    if (c === '"') { quoted = true; text += c; continue }
    if (c === '/' && next === '/') { while (i < input.length && input[i] !== '\n') i++; text += '\n'; continue }
    if (c === '/' && next === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i++; text += ' '; continue }
    text += c
  }
  let clean = ''; quoted = false; escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) { clean += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue }
    if (c === '"') quoted = true
    if (c === ',') { let j = i + 1; while (j < text.length && /\s/.test(text[j])) j++; if (text[j] === ']' || text[j] === '}') continue }
    clean += c
  }
  return JSON.parse(clean)
}
export const CONTINUITY = 'Escreva um resumo conciso para continuar esta sessão: objetivo, resultados verificados, alterações, verificações realizadas, pendências e próxima ação. Separe fatos de suposições. Não execute comandos nem altere arquivos para produzir o resumo.'

// Traduz apenas a apresentação; os identificadores da API permanecem intactos.
export function label(value: string): string {
  const labels: Record<string, string> = {
    home: 'Início', usage: 'Consumo', notices: 'Notificações', focus: 'Foco', appearance: 'Temas', model: 'Modelo', profiles: 'Perfis', agents: 'Agentes',
    context: 'Contexto', '5h': 'Limite de 5h', '7d': 'Limite de 7 dias',
    session: 'sessão', project: 'projeto', global: 'global',
    working: 'Em andamento', done: 'Concluído', waiting: 'Aguardando', interrupted: 'Interrompido', error: 'Erro',
    pending: 'Pendente', active: 'Em execução', blocked: 'Bloqueado',
    running: 'Em execução', completed: 'Concluído', failed: 'Falhou', killed: 'Encerrado', unknown: 'Não informado', agent: 'Agente',
    low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo',
    default: 'Padrão', plan: 'Planejamento', acceptEdits: 'Aceitar edições', auto: 'Automático', bypassPermissions: 'Ignorar permissões',
    accent: 'Cor de destaque', background: 'Cor de fundo', foreground: 'Cor do texto',
  }
  return labels[value] ?? value
}
