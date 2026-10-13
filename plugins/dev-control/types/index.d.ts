export type Panel = 'main' | 'zen' | 'themes' | 'mode' | 'status' | 'notifications' | 'usage' | 'profiles' | 'agents'

export type ZenTheme = 'blue' | 'dark' | 'light' | 'green' | 'rainbow' | 'custom'

export type ZenColors = { bar: string; text: string; border: string }

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'

export type ZenOutcome = 'running' | 'completed' | 'waiting' | 'interrupted' | 'failed'

export type ZenStep = { id: string; text: string; status: StepStatus }

export type ZenTask = {
  title: string
  startedAt: number
  doneAt: number | null
  steps: ZenStep[]
  outcome?: ZenOutcome
}

export type ThemeEntry = { slug: string; name: string }

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type RateLimit = { label: string; percent: number; resetsAt: number | null }

// What the status line draws, refreshed after each model response and on a timer.
export type StatusSnapshot = {
  model: string
  dir: string
  branch: string
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  limits: RateLimit[]
}

declare module 'claude-code' {
  interface PluginState {
    'dev-control': {
      controls: ControlState
      effortForSubagents: boolean
      menu: Panel | null
      zenOn: boolean
      zenTheme: ZenTheme
      zenCustom: ZenColors
      zenCollapsed: boolean
      task: ZenTask | null
      now: number
      themes: ThemeEntry[]
      themeName: string | null
      themeQuery: string
      themeStatus: string
      effort: Effort | null
      mode: string | null
      defaultMode: string | null
      preview: string | null
      isDownloading: boolean
      statusOn: boolean
      status: StatusSnapshot | null
      lastResponseAt: number | null
      statusClock: number
      sessionEffort: Effort | null
      sessionModel: string | null
      paneBg: string | null
      defaultModeChosen: boolean
    }
  }
}


export type NoticeKind = 'usage' | 'finished' | 'error' | 'waiting'
export type NoticeSettings = {
  terminal: boolean; sound: boolean; desktop: boolean
  context: boolean; limits: boolean; finished: boolean; errors: boolean; waiting: boolean
  thresholds: number[]; refreshSeconds: number; cooldownSeconds: number
}
export type Metric = { id: string; label: string; percent: number; cycle: string }
export type Ledger = Record<string, { cycle: string; previous: number; sent: number[] }>
export type Profile = {
  version: 1; root?: string; model: string | null; effort: Effort | null
  zenOn: boolean; zenTheme: string; theme: string | null; notices: NoticeSettings
}
export type AgentRow = { id: string; description: string; type: string; status: string; parentId?: string; name?: string; spawnedBy?: string } & { model?: string; effort?: string; result?: string; startedAt?: number; endedAt?: number }
export type ControlState = {
  notices: NoticeSettings; usageAt: number | null; usageError: string | null
  agents: AgentRow[]; agentsError: string | null; agentFilter: string; selectedAgent: string | null
  details: boolean; root: string; profileScope: string; delivery: string; busy: boolean; refreshToken: string | null
}
