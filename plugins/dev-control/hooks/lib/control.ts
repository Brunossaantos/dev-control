import type { Effort, ZenTask, NoticeSettings, ControlState, Metric, Ledger, Profile } from '../../types'

export const DEFAULT_NOTICES: NoticeSettings = {
  terminal: true, sound: false, desktop: false, context: true, limits: true, finished: false, errors: true, waiting: true,
  thresholds: [70, 85, 95], refreshSeconds: 30, cooldownSeconds: 60,
}
export function initialControl(): ControlState {
  return { notices: { ...DEFAULT_NOTICES, thresholds: [...DEFAULT_NOTICES.thresholds] }, usageAt: null,
    usageError: null, agents: [], agentsError: null, agentFilter: '', selectedAgent: null,
    details: false, root: '', profileScope: 'session', delivery: '', busy: false, refreshToken: null }
}
export function parseThresholds(text: string): number[] | null {
  if (!/^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(text)) return null
  const values = [...new Set(text.split(',').map(Number))].sort((a, b) => a - b)
  return values.length >= 1 && values.length <= 6 && values.every(n => n >= 1 && n <= 100) ? values : null
}
export function normalizeNotices(raw: unknown): NoticeSettings {
  const result = { ...DEFAULT_NOTICES, thresholds: [...DEFAULT_NOTICES.thresholds] }
  if (raw === null || typeof raw !== 'object') return result
  const source = raw as Record<string, unknown>
  for (const key of ['terminal', 'sound', 'desktop', 'context', 'limits', 'finished', 'errors', 'waiting'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  if (Array.isArray(source.thresholds) && source.thresholds.every(n => typeof n === 'number')) {
    const parsed = parseThresholds(source.thresholds.join(','))
    if (parsed !== null) result.thresholds = parsed
  }
  for (const [key, min, max] of [['refreshSeconds', 15, 300], ['cooldownSeconds', 5, 600]] as const) {
    const n = source[key]
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = Math.max(min, Math.min(max, Math.round(n)))
  }
  return result
}
export function normalizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<Profile>
  if (p.version !== 1 || typeof p.zenOn !== 'boolean') return null
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
  if (p.model !== null && (typeof p.model !== 'string' || p.model.length > 120)) return null
  if (p.effort !== null && !efforts.includes(p.effort ?? '')) return null
  return { version: 1, root: typeof p.root === 'string' ? p.root : undefined,
    model: p.model!, effort: p.effort!, zenOn: p.zenOn,
    zenTheme: typeof p.zenTheme === 'string' ? p.zenTheme : 'blue',
    theme: typeof p.theme === 'string' ? p.theme : null, notices: normalizeNotices(p.notices) }
}

// Missing readings do not reset the ledger. Jumping several thresholds sends one alert.
export function crossedThresholds(metrics: Metric[], previous: Ledger, thresholds: number[]): { ledger: Ledger; alerts: string[] } {
  const ledger: Ledger = { ...previous }
  const alerts: string[] = []
  for (const metric of metrics) {
    if (!Number.isFinite(metric.percent) || metric.percent < 0) continue
    const before = previous[metric.id]
    const reset = !before || before.cycle !== metric.cycle ||
      (metric.id === 'context' ? before.previous - metric.percent >= 10 : before.previous >= 70 && metric.percent < 20)
    const sent = reset ? [] : before.sent
    const crossed = thresholds.filter(n => metric.percent >= n && !sent.includes(n))
    if (crossed.length) alerts.push(`${metric.label}: ${Math.round(metric.percent)}% (alert ${crossed.at(-1)}%)`)
    ledger[metric.id] = { cycle: metric.cycle, previous: metric.percent, sent: [...new Set([...sent, ...crossed])] }
  }
  return { ledger, alerts }
}
export function normalizeRoot(root: string): string {
  let path = root.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
  if (/^[a-z]:\//i.test(path)) path = path.toLowerCase()
  return path
}
export function resolveProfile(project: unknown, global: unknown, root: string): { profile: Profile | null; scope: string } {
  const p = normalizeProfile(project)
  if (p && p.root === normalizeRoot(root)) return { profile: p, scope: 'project' }
  const g = normalizeProfile(global)
  return { profile: g, scope: g ? 'global' : 'session' }
}
export function finishTask(task: ZenTask, reason: string): ZenTask {
  const outcome = reason === 'aborted' ? 'interrupted' : reason === 'error' || reason === 'refusal' ? 'failed' :
    task.outcome === 'failed' || task.steps.some(s => s.status === 'failed') ? 'failed' :
    task.outcome === 'waiting' || task.outcome === 'interrupted' ? task.outcome :
    task.steps.length > 0 && task.steps.every(s => s.status === 'completed') ? 'completed' : 'waiting'
  return { ...task, outcome }
}
export function hasFailure(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const r = output as Record<string, unknown>
  return r.isError === true || r.interrupted === true || (typeof r.exitCode === 'number' && r.exitCode !== 0)
}
export function overrideEffort(agentId: string | undefined, current: Effort | number | undefined, desired: Effort | null, subagents: boolean): Effort | number | undefined {
  return desired !== null && current !== undefined && (agentId === undefined || subagents) ? desired : current
}

const WINDOWS_NOTICE = `Add-Type -AssemblyName System.Windows.Forms
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.Visible = $true
try { $icon.ShowBalloonTip(3000, $env:DEV_CONTROL_TITLE, $env:DEV_CONTROL_MESSAGE, [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Milliseconds 3200 }
finally { $icon.Dispose() }`
const MAC_NOTICE = 'on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run'
export function desktopCommand(platform: 'windows' | 'mac' | 'linux', title: string, message: string): { argv: string[]; env: Record<string, string> } {
  if (platform === 'windows') return { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_NOTICE],
    env: { DEV_CONTROL_TITLE: title, DEV_CONTROL_MESSAGE: message } }
  return { argv: platform === 'mac' ? ['osascript', '-e', MAC_NOTICE, title, message] : ['notify-send', '--app-name=Dev Control', '--', title, message], env: {} }
}
export const HANDOFF_PROMPT = 'Prepare a concise handoff for continuing this work in another session. Include the goal, verified changes, modified files, tests and their actual results, pending items, and the next action. Distinguish facts from assumptions. Do not run commands or modify files for this summary.'
