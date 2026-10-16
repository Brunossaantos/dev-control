export type Screen = 'home' | 'usage' | 'notices' | 'focus' | 'appearance' | 'model' | 'profiles' | 'agents'
export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Preferences = {
  channels: { terminal: boolean; audio: boolean; desktop: boolean }
  events: { context: boolean; account: boolean; response: boolean; failures: boolean; input: boolean }
  levels: number[]; interval: number; cooldown: number
  focus: boolean; details: boolean; effort: Level | null; workerEffort: boolean
  model: string | null; palette: string | null; accent: string; background: string; foreground: string
}
export type Step = { id?: string; title: string; state: 'pending' | 'active' | 'done' | 'error' | 'blocked' }
export type Plan = { title: string; steps: Step[]; state: 'working' | 'done' | 'waiting' | 'interrupted' | 'error'; started: number; stopped: number | null }
export type Reading = { key: string; value: number | null; reset: string | null }
export type Usage = { checked: number; model: string; directory: string; branch: string; tokens: number | null; window: number | null; readings: Reading[] }
export type Worker = { id: string; name?: string; type: string; description: string; status: string; parentId?: string; model?: string; effort?: string; summary?: string }
export type Palette = { id: string; label: string; accent: string; background: string; foreground: string }
export type WindowsRestore = { path: string; profile: string; scheme: string; original: unknown }
export type Dashboard = {
  screen: Screen | null; prefs: Preferences; usage: Usage | null; root: string; profile: string
  error: string; delivery: string; workers: Worker[]; workerError: string; selected: string | null; filter: string
  plan: Plan | null; permission: string | null; busy: string | null; clock: number; windows: WindowsRestore | null; lastReply: number | null
}
export type SavedPreferences = { version: 2; root?: string; preferences: Preferences }
export type AlertMemory = Record<string, { cycle: string; value: number; band: number }>
declare module 'claude-code' {
  interface PluginState { 'dev-control': { dashboard: Dashboard } }
}
