import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderInput, Timer } from 'claude-code'
import { finishTask, hasFailure, overrideEffort } from './lib/control'
import type { Metric, Ledger, Profile, AgentRow, ControlState, NoticeSettings, NoticeKind } from '../types'
import { initialControl, normalizeNotices, normalizeRoot, resolveProfile, parseThresholds, crossedThresholds, desktopCommand, HANDOFF_PROMPT } from './lib/control'

import type { Effort, Panel, RateLimit, StatusSnapshot, ThemeEntry, ZenColors, ZenStep, ZenTask, ZenTheme } from '../types'
import { EFFORTS, type Mode, MODELS, MODES, modeLabel, modelFamily } from './lib/modes'
import {
  backgroundPill,
  BAR_WIDTH,
  barFill,
  cacheState,
  colorFor,
  type Detail,
  fmtDuration,
  fmtTokens,
  LIMIT_LABELS,
  STATUS_CYAN,
  STATUS_GREEN,
  STATUS_RED,
  statsWidth,
} from './lib/status'
import {
  findProfile,
  matchAll,
  type Palette,
  parseJsonc,
  targetProfile,
  toPalette,
  toClaudeTheme,
  withProfileTheme,
  WT_SCHEME,
  type WtSettings,
} from './lib/palette'
import {
  asStatus,
  barCells,
  colorsFor,
  elapsed,
  percentOf,
  stepLabel,
  visibleSteps,
  ZEN_PROMPT,
  ZEN_TOOL_DESCRIPTION,
  ZEN_TOOL_NAME,
  ZEN_TOOL_SCHEMA,
  ZEN_THEMES,
} from './lib/zen'

export const controls = atom({ plugin: 'dev-control', key: 'controls' } as const, initialControl())
export const effortForSubagents = atom({ plugin: 'dev-control', key: 'effortForSubagents' } as const, false)

// Every value the drawings read. Settings worth keeping across sessions are
// mirrored to $.store under the same key.
const menu = atom({ plugin: 'dev-control', key: 'menu' } as const, null)
const zenOn = atom({ plugin: 'dev-control', key: 'zenOn' } as const, false)
const zenTheme = atom({ plugin: 'dev-control', key: 'zenTheme' } as const, 'blue')
const zenCustom = atom(
  { plugin: 'dev-control', key: 'zenCustom' } as const,
  { bar: '#3b82f6', text: '#e2e8f0', border: '#3b82f6' } satisfies ZenColors,
)
const zenCollapsed = atom({ plugin: 'dev-control', key: 'zenCollapsed' } as const, false)
const task = atom({ plugin: 'dev-control', key: 'task' } as const, null)
const now = atom({ plugin: 'dev-control', key: 'now' } as const, 0)
const themes = atom({ plugin: 'dev-control', key: 'themes' } as const, [])
const themeName = atom({ plugin: 'dev-control', key: 'themeName' } as const, null)
const themeQuery = atom({ plugin: 'dev-control', key: 'themeQuery' } as const, '')
const themeStatus = atom({ plugin: 'dev-control', key: 'themeStatus' } as const, '')
const effort = atom({ plugin: 'dev-control', key: 'effort' } as const, null)
const mode = atom({ plugin: 'dev-control', key: 'mode' } as const, null)
const defaultMode = atom({ plugin: 'dev-control', key: 'defaultMode' } as const, null)
const preview = atom({ plugin: 'dev-control', key: 'preview' } as const, null)
const isDownloading = atom({ plugin: 'dev-control', key: 'isDownloading' } as const, false)
const sessionEffort = atom({ plugin: 'dev-control', key: 'sessionEffort' } as const, null)
const sessionModel = atom({ plugin: 'dev-control', key: 'sessionModel' } as const, null)
const paneBg = atom({ plugin: 'dev-control', key: 'paneBg' } as const, null)
const defaultModeChosen = atom({ plugin: 'dev-control', key: 'defaultModeChosen' } as const, false)
const statusOn = atom({ plugin: 'dev-control', key: 'statusOn' } as const, false)
const status = atom({ plugin: 'dev-control', key: 'status' } as const, null)
const lastResponseAt = atom({ plugin: 'dev-control', key: 'lastResponseAt' } as const, null)
const statusClock = atom({ plugin: 'dev-control', key: 'statusClock' } as const, 0)

// The menu's pane: a sidebar in the fullscreen layout, a block above the prompt otherwise.
// Claude's progress tool, as the model calls it.
const ZEN_TOOL = 'mcp__dev-control__zen_progress'

const PANE = 'dev-control-tools'
const PANE_SIZE = { rows: 26, columns: 56 }
// Used until the terminal's own background is known: just short of pure black.
const PANE_BACKGROUND = '#0b0b0b'
const MENU_NAME = 'dev-control'
// Room the engine's own mode label takes left of the hint row (⏵⏵ auto mode on · ).
const MODE_LABEL_COLUMNS = 22
// The slug of the Claude Code theme the mod writes: ~/.claude/themes/dev-control.json.
const CLAUDE_THEME = 'dev-control'

// Windows Terminal's built-in schemes, by name: their backgrounds.
const WT_BUILTIN_BACKGROUNDS: Record<string, string> = {
  Campbell: '#0C0C0C',
  'Campbell Powershell': '#012456',
  'Dark+': '#1E1E1E',
  Dimidium: '#141414',
  'One Half Dark': '#282C34',
  'One Half Light': '#FFFFFF',
  Ottosson: '#000000',
  'Solarized Dark': '#002B36',
  'Solarized Light': '#FDF6E3',
  'Tango Dark': '#000000',
  'Tango Light': '#FFFFFF',
  Vintage: '#000000',
}

// Each permission mode in the color Claude Code draws it with.
const MODE_COLORS: Record<string, string> = {
  default: 'text',
  plan: 'planMode',
  acceptEdits: 'autoAccept',
  auto: 'warning',
  dontAsk: 'warning',
  bypassPermissions: 'error',
}

const SITE = 'https://terminalcolors.com'
const HEX = /^#[0-9a-f]{6}$/i

// Paths and platform --------------------------------------------------------

async function homeDir($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return home.replaceAll('\\', '/')
}

async function themesDir($: EngineInterface) {
  return `${await homeDir($)}/.claude/dev-control/themes`
}

async function isWindows($: EngineInterface) {
  return (await $.env.get('OS')) === 'Windows_NT'
}

// Zen settings ---------------------------------------------------------------

async function setZenOn($: EngineInterface, isOn: boolean) {
  await update($, zenOn, () => isOn)
  if (!isOn) await update($, task, () => null)
}

async function setZenTheme($: EngineInterface, theme: ZenTheme) {
  await update($, zenTheme, () => theme)
}

async function setZenColor($: EngineInterface, part: keyof ZenColors, value: string) {
  if (!HEX.test(value.trim())) {
    $.ui.toast(`${value} is not a hex color like #3b82f6`)
    return
  }
  const colors = await update($, zenCustom, c => ({ ...c, [part]: value.trim() }))
  await $.store.set('zenCustom', colors)
}

// Themes ---------------------------------------------------------------------

async function fetchText($: EngineInterface, url: string) {
  const res = await $.http.fetch(url)
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  return res.text
}

async function sayTheme($: EngineInterface, text: string) {
  await update($, themeStatus, () => text)
}

// Reads the saved YAML files into the list the picker shows.
async function indexThemes($: EngineInterface) {
  const dir = await themesDir($)
  const list: ThemeEntry[] = []
  if (await $.fs.exists(dir)) {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.yaml')) continue
      const palette = toPalette(await $.fs.read(`${dir}/${entry.name}`))
      if (palette !== null) list.push({ slug: entry.name.replace(/\.yaml$/, ''), name: palette.name })
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  await update($, themes, () => list)
  return list
}

// Scrapes every theme page on terminalcolors.com and saves each theme's YAML.
async function downloadThemes($: EngineInterface) {
  const dir = await themesDir($)
  await sayTheme($, 'Reading terminalcolors.com…')
  const homePage = await fetchText($, `${SITE}/`)
  const variants = new Set(matchAll(homePage, /href="(\/themes\/[\w-]+\/[\w-]+\/)"/g))
  // A family page can list variants the home page leaves out.
  for (const family of new Set(matchAll(homePage, /href="(\/themes\/[\w-]+\/)"/g))) {
    try {
      for (const v of matchAll(await fetchText($, SITE + family), /href="(\/themes\/[\w-]+\/[\w-]+\/)"/g)) {
        variants.add(v)
      }
    } catch {}
  }

  const pages = [...variants]
  let done = 0
  let saved = 0
  // Six downloads at a time.
  for (let i = 0; i < pages.length; i += 6) {
    await Promise.all(
      pages.slice(i, i + 6).map(async page => {
        try {
          const yamlPath = matchAll(await fetchText($, SITE + page), /href="(\/downloads\/warp\/[^"]+\.ya?ml)"/g)[0]
          if (yamlPath === undefined) return
          const yaml = await fetchText($, SITE + yamlPath)
          if (toPalette(yaml) === null) return
          const file = yamlPath.split('/').pop()!.replace(/\.yml$/, '.yaml')
          await $.fs.write(`${dir}/${file}`, yaml)
          saved++
        } catch {
        } finally {
          done++
        }
      }),
    )
    await sayTheme($, `Downloading themes… ${done}/${pages.length}`)
  }

  await indexThemes($)
  await sayTheme($, `Saved ${saved} themes to ${dir}`)
}

async function wtSettingsPath($: EngineInterface, profileId: string | null) {
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replaceAll('\\', '/')
  const candidates = [
    `${local}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Microsoft/Windows Terminal/settings.json`,
  ]
  let first: string | null = null
  for (const path of candidates) {
    if (local === '' || !(await $.fs.exists(path))) continue
    first ??= path
    const text = await $.fs.read(path)
    if (profileId !== null && text.toLowerCase().includes(profileId.toLowerCase())) return path
  }
  return first
}

// The background of the terminal Claude Code runs in: Windows Terminal's
// profile and scheme, else the kept theme's.
async function terminalBackground($: EngineInterface): Promise<string | null> {
  if (await isWindows($)) {
    const profileId = (await $.env.get('WT_PROFILE_ID')) ?? null
    const path = await wtSettingsPath($, profileId)
    if (path === null) return null
    const settings = parseJsonc(await $.fs.read(path)) as WtSettings
    const profile = targetProfile(settings, profileId) as { background?: unknown; colorScheme?: unknown }
    if (typeof profile.background === 'string') return profile.background
    const defaults = (Array.isArray(settings.profiles) ? undefined : settings.profiles?.defaults) as
      | { background?: unknown; colorScheme?: unknown }
      | undefined
    if (typeof defaults?.background === 'string') return defaults.background
    const raw = profile.colorScheme ?? defaults?.colorScheme ?? 'Campbell'
    const name = typeof raw === 'string' ? raw : ((raw as { dark?: string }).dark ?? 'Campbell')
    const scheme = (settings.schemes ?? []).find(sc => sc.name === name) as { background?: unknown } | undefined
    if (typeof scheme?.background === 'string') return scheme.background
    return WT_BUILTIN_BACKGROUNDS[name] ?? null
  }
  const kept = (await $.store.get('theme')) as { slug: string } | undefined
  if (kept === undefined) return null
  return toPalette(await $.fs.read(`${await themesDir($)}/${kept.slug}.yaml`))?.background ?? null
}

async function refreshPaneBg($: EngineInterface) {
  try {
    const bg = await terminalBackground($)
    await update($, paneBg, () => bg)
  } catch {}
}

// The `theme` in ~/.claude/settings.json, written directly: /config's theme row
// takes only the built-in themes ("For custom themes, use /theme"), so a custom
// one can only be chosen here. Claude Code reads it once, at startup, and loads
// ~/.claude/themes/ at startup only when that theme is a custom one.
async function writeThemeSetting($: EngineInterface, value: string): Promise<boolean> {
  const path = `${await homeDir($)}/.claude/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const settings = JSON.parse(text) as { theme?: unknown }
  if (settings.theme === value) return false
  const backup = `${path}.dev-control.bak`
  if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
  settings.theme = value
  await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  return true
}

// Selects a Claude Code theme by its /theme value (`dark`, `custom:<slug>`),
// first keeping the one it replaces, so a reset can put it back.
async function selectClaudeTheme($: EngineInterface, value: string) {
  const row = (await $.config.list()).find(r => r.key === 'theme')
  if (row === undefined) throw new Error('Claude Code has no theme setting to change')
  if (row.value === value) return
  if (value === `custom:${CLAUDE_THEME}` && (await $.store.get('themeBefore')) === undefined) {
    await $.store.set('themeBefore', row.value)
  }
  if (!value.startsWith('custom:') || row.options?.includes(value)) {
    const set = await $.config.set({ key: 'theme', value })
    if (set.deny === undefined) return
    if (!value.startsWith('custom:')) throw new Error(set.deny)
  }
  if (await writeThemeSetting($, value)) {
    $.ui.toast(`Restart Claude Code once to switch to the ${CLAUDE_THEME} theme; after that, themes change live`)
  }
}

// Windows: the kept theme, background included, on the Windows Terminal
// profile this tab runs in. Windows Terminal reloads its settings live, so the
// tab repaints at once; other open tabs on the same profile take the theme too
// while the session runs. The profile's own scheme is kept in the store before
// the first change and goes back with null, at session end; a session that
// crashed leaves it there, and the next session's end puts it back.
async function paintWindowsTerminal($: EngineInterface, palette: Palette | null) {
  const profileId = (await $.env.get('WT_PROFILE_ID')) ?? null
  if (profileId === null) return
  const path = await wtSettingsPath($, profileId)
  if (path === null) return
  const text = await $.fs.read(path)
  const settings = parseJsonc(text) as WtSettings
  const profile = findProfile(settings, profileId)
  if (profile === undefined) return
  const key = profileId.toLowerCase()
  const originals = ((await $.store.get('wtOriginal')) ?? {}) as Record<string, { colorScheme?: unknown }>
  if (palette === null && originals[key] === undefined) return
  if (originals[key] === undefined) {
    originals[key] = profile.colorScheme === undefined || profile.colorScheme === WT_SCHEME ? {} : { colorScheme: profile.colorScheme }
    await $.store.set('wtOriginal', originals)
  }
  withProfileTheme(settings, profile, palette, originals[key].colorScheme)
  const out = JSON.stringify(settings, null, 4)
  if (out !== JSON.stringify(parseJsonc(text), null, 4)) {
    const backup = `${path}.dev-control.bak`
    if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
    await $.fs.write(path, out)
  }
  if (palette === null) {
    delete originals[key]
    await $.store.set('wtOriginal', originals)
  }
  await refreshPaneBg($)
}

// Paints Claude Code with a saved theme: written as the custom theme
// ~/.claude/themes/dev-control.json, which Claude Code reloads live, and
// selected. On Windows this tab's Windows Terminal profile takes the theme
// too, background included. null selects the theme that was in use before
// the mod's first one, and gives the profile its own colors back.
async function paintTerminal($: EngineInterface, slug: string | null) {
  if (slug === null) {
    const before = (await $.store.get('themeBefore')) as string | undefined
    await selectClaudeTheme($, before ?? 'dark')
    await $.store.delete('themeBefore')
    if (await isWindows($)) await paintWindowsTerminal($, null)
    return null
  }
  const palette = toPalette(await $.fs.read(`${await themesDir($)}/${slug}.yaml`))
  if (palette === null) throw new Error(`${slug}.yaml is not a theme this mod can read`)
  const dir = `${await homeDir($)}/.claude/themes`
  await $.fs.write(`${dir}/${CLAUDE_THEME}.json`, `${JSON.stringify(toClaudeTheme(palette), null, 2)}\n`)
  await selectClaudeTheme($, `custom:${CLAUDE_THEME}`)
  if (await isWindows($)) await paintWindowsTerminal($, palette)
  return palette
}

// Keeps a theme (null: the terminal's own colors) for this and later sessions.
async function applyTheme($: EngineInterface, slug: string | null) {
  const palette = await paintTerminal($, slug)
  await update($, preview, () => null)
  await update($, themeName, () => palette?.name ?? null)
  if (palette === null) await $.store.delete('theme')
  else await $.store.set('theme', { slug: slug!, name: palette.name })
  await sayTheme($, palette ? `Kept ${palette.name}` : "Back to Claude Code's previous theme")
}

// Shows a theme on the terminal without keeping it.
async function previewTheme($: EngineInterface, slug: string) {
  const palette = await paintTerminal($, slug)
  await update($, preview, () => slug)
  await sayTheme($, `Previewing ${palette?.name ?? slug}: Enter or click keeps it`)
}

// Puts the kept theme back after a preview that was not kept.
async function endPreview($: EngineInterface) {
  if ((await read($, preview)) === null) return
  const kept = (await $.store.get('theme')) as { slug: string } | undefined
  await paintTerminal($, kept?.slug ?? null)
  await update($, preview, () => null)
  await sayTheme($, '')
}

// The first look at the themes downloads them; once, however often it is asked.
async function ensureThemes($: EngineInterface) {
  if ((await read($, themes)).length > 0 || (await read($, isDownloading))) return
  await update($, isDownloading, () => true)
  try {
    await downloadThemes($)
  } catch (error) {
    await sayTheme($, `Download failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, isDownloading, () => false)
  }
}

// Runs a theme action from a button, reporting a failure in the panel.
function themeAction($: EngineInterface, work: () => Promise<unknown>) {
  return () => {
    void work().catch((error: unknown) =>
      sayTheme($, `Failed: ${error instanceof Error ? error.message : String(error)}`),
    )
  }
}

async function loadThemes($: EngineInterface) {
  const list = await indexThemes($)
  const saved = (await $.store.get('theme')) as { slug: string; name: string } | undefined
  if (saved === undefined) return
  if (!list.some(t => t.slug === saved.slug)) return
  await update($, themeName, () => saved.name)
  // This tab's Windows Terminal profile takes the kept theme for the session.
  try {
    if (await isWindows($)) await paintWindowsTerminal($, toPalette(await $.fs.read(`${await themesDir($)}/${saved.slug}.yaml`)))
  } catch {}
}

// Mode and effort --------------------------------------------------------------

// The effort every request of this session is sent with. When /config has an
// effort row, it is changed too, so Claude Code's own display agrees.
async function setEffort($: EngineInterface, level: Effort) {
  await update($, effort, () => level)
  $.ui.toast(`Session effort: ${level}. Save a profile to keep it.`)
}

// Switches the session's model through Claude Code's own `/model`, so /model,
// the status line and the requests all agree. It runs once the session is idle.
async function setModel($: EngineInterface, alias: string) {
  await $.command.run({ command: 'model', args: alias })
  const id = await $.session.model()
  await update($, sessionModel, () => id)
  if (await read($, statusOn)) void refreshStatus($).catch(() => {})
  $.ui.toast(`Model: ${prettyModel(id)}`)
}

async function trackModel($: EngineInterface, id: string) {
  if (id !== (await read($, sessionModel))) await update($, sessionModel, () => id)
}

// permissions.defaultMode in ~/.claude/settings.json: the mode new sessions
// start in. A running session's mode is shift+tab's; a mod cannot set it.
async function setDefaultMode($: EngineInterface, next: Mode) {
  const path = `${await homeDir($)}/.claude/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const backup = `${path}.dev-control.bak`
  if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
  const settings = JSON.parse(text) as { permissions?: Record<string, unknown> }
  settings.permissions = { ...settings.permissions, defaultMode: next }
  await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  await update($, defaultMode, () => next)
  await update($, defaultModeChosen, () => true)
  $.ui.toast(`New sessions start in ${modeLabel(next)} mode`)
}

async function trackMode($: EngineInterface, current: string | undefined) {
  if (current !== undefined && current !== (await read($, mode))) await update($, mode, () => current)
}

// The session's own effort level before any request. First match wins: a
// /config row, the effortLevel setting, CLAUDE_EFFORT, the last level seen.
async function loadSessionEffort($: EngineInterface) {
  const found: unknown[] = []
  try {
    found.push((await $.config.list()).find(r => /effort/i.test(r.key))?.value)
  } catch {}
  try {
    found.push(((await $.settings.read()) as { effortLevel?: unknown }).effortLevel)
  } catch {}
  found.push(await $.env.get('CLAUDE_EFFORT'))
  found.push(await $.store.get('lastSessionEffort'))
  const level = found.find((v): v is Effort => typeof v === 'string' && EFFORTS.includes(v as Effort))
  if (level !== undefined) await update($, sessionEffort, () => level)
}

// Records the level a request actually ran at, as the engine reports it.
async function trackEffort($: EngineInterface, level: unknown) {
  if (typeof level !== 'string' || !EFFORTS.includes(level as Effort)) return
  const own = level as Effort
  if (own === (await read($, sessionEffort))) return
  await update($, sessionEffort, () => own)
  await $.store.set('lastSessionEffort', own)
}

async function loadSettings($: EngineInterface) {
  const saved = {
    zenOn: (await $.store.get('zenOn')) as boolean | undefined,
    zenTheme: (await $.store.get('zenTheme')) as ZenTheme | undefined,
    zenCustom: (await $.store.get('zenCustom')) as ZenColors | undefined,
    effort: (await $.store.get('effort')) as Effort | undefined,
  }
  if (saved.zenOn !== undefined) await update($, zenOn, () => saved.zenOn!)
  if (saved.zenTheme !== undefined && ZEN_THEMES.includes(saved.zenTheme)) await update($, zenTheme, () => saved.zenTheme!)
  if (saved.zenCustom !== undefined) await update($, zenCustom, () => saved.zenCustom!)
  if (saved.effort !== undefined && EFFORTS.includes(saved.effort)) await update($, effort, () => saved.effort!)
  try {
    const { permissions } = await $.settings.read({ source: 'user' })
    const configured = (permissions as { defaultMode?: string } | undefined)?.defaultMode
    await update($, defaultMode, () => configured ?? 'default')
  } catch {}
}

// Status line -------------------------------------------------------------------

// Gathers what the status line draws: the model, the folder and branch, the
// context window and the rate limits, as Claude Code's own status line has them.
async function refreshStatus($: EngineInterface) {
  const token = `${Date.now()}-${Math.random()}`
  const reserved = await update($, controls, c => c.busy ? c : { ...c, busy: true, refreshToken: token })
  if (reserved.refreshToken !== token) return
  try {
    const [model, cwd, usage] = await Promise.all([$.session.model(), $.session.cwd(), $.session.usage()])
    let branch = ''
    try {
      const ran = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { timeoutMs: 2000 })
      if (ran.exitCode === 0) branch = ran.stdout.trim()
    } catch {}
    const limits: RateLimit[] = usage.rateLimits
      .filter(l => LIMIT_LABELS[l.kind] !== undefined && Number.isFinite(l.percentUsed))
      .map(l => ({ label: LIMIT_LABELS[l.kind]!, percent: l.percentUsed,
        resetsAt: l.resetsAt === undefined || !Number.isFinite(Date.parse(l.resetsAt)) ? null : Date.parse(l.resetsAt) }))
    const snapshot: StatusSnapshot = { model, dir: cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd,
      branch, ctxPercent: typeof usage.context.percent === 'number' && Number.isFinite(usage.context.percent) ? usage.context.percent : null,
      ctxTokens: usage.context.tokens ?? null, ctxWindow: usage.context.window, limits }
    await update($, status, () => snapshot)
    const checkedAt = await $.clock.now()
    await update($, controls, c => ({ ...c, usageAt: checkedAt, usageError: null }))
    const metrics: Metric[] = limits.map(l => ({ id: l.label, label: `${l.label} account limit`, percent: l.percent,
      cycle: l.resetsAt === null ? 'unknown' : String(l.resetsAt) }))
    if (snapshot.ctxPercent !== null) metrics.push({ id: 'context', label: 'Conversation context', percent: snapshot.ctxPercent, cycle: await $.session.id() })
    await checkUsage($, metrics)
  } catch {
    await update($, controls, c => ({ ...c, usageError: 'Usage reading unavailable. Previous values may be stale.' }))
  } finally {
    await update($, controls, c => c.refreshToken === token ? { ...c, busy: false, refreshToken: null } : c)
  }
}

async function pollControl($: EngineInterface) {
  const c = await read($, controls)
  const panel = await read($, menu)
  if (c.usageAt === null || (await $.clock.now()) - c.usageAt >= c.notices.refreshSeconds * 1000) await refreshStatus($)
  if (panel === 'agents') await refreshAgents($)
}

async function captureProfile($: EngineInterface): Promise<Omit<Profile, 'version' | 'root' | 'notices'>> {
  return { model: await $.session.model(), effort: await read($, effort),
    zenOn: await read($, zenOn), zenTheme: await read($, zenTheme),
    theme: ((await $.store.get('theme')) as { slug?: string } | undefined)?.slug ?? null }
}
async function applyProfile($: EngineInterface, p: Profile) {
  await update($, effort, () => p.effort)
  await update($, zenOn, () => p.zenOn)
  if (ZEN_THEMES.includes(p.zenTheme as ZenTheme)) await update($, zenTheme, () => p.zenTheme as ZenTheme)
  if (p.model && p.model !== await $.session.model()) await setModel($, p.model)
  if (p.theme) { await indexThemes($); await applyTheme($, p.theme) }
  else if ((await $.store.get('theme')) !== undefined) await applyTheme($, null)
}

type SavedStatusLine = { statusLine: unknown }

// On: the mod draws the status line, so Claude Code's own statusLine command is
// taken out of ~/.claude/settings.json (kept, to put back when it goes off).
async function setStatusOn($: EngineInterface, isOn: boolean) {
  const path = `${await homeDir($)}/.claude/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const backup = `${path}.dev-control.bak`
  if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
  const settings = JSON.parse(text) as { statusLine?: unknown }
  const saved = (await $.store.get('savedStatusLine')) as SavedStatusLine | undefined
  if (isOn && settings.statusLine !== undefined) {
    await $.store.set('savedStatusLine', { statusLine: settings.statusLine } satisfies SavedStatusLine)
    delete settings.statusLine
    await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  } else if (!isOn && saved !== undefined && settings.statusLine === undefined) {
    settings.statusLine = saved.statusLine
    await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
    await $.store.delete('savedStatusLine')
  }
  await update($, statusOn, () => isOn)
  await $.store.set('statusOn', isOn)
  if (isOn) await refreshStatus($)
}

async function loadStatus($: EngineInterface) {
  const isOn = (await $.store.get('statusOn')) as boolean | undefined
  if (isOn === true) await update($, statusOn, () => true)
  // Never chosen: on, so the button shares the stats row (the status line
  // command, if any, is kept and comes back with Off).
  if (isOn === undefined) await setStatusOn($, true).catch(() => {})
  await update($, statusClock, () => Date.now())
  try {
    await refreshStatus($)
  } catch {}
}

// Drawing ----------------------------------------------------------------------

// Zen's progress band; null when there is nothing to show.
async function drawZenBand($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const t = await read($, task)
  if (!(await read($, zenOn)) || t === null) return null

  const theme = await read($, zenTheme)
  const colors = colorsFor(theme, await read($, zenCustom))
  const isCollapsed = await read($, zenCollapsed)
  const clock = await read($, now)
  const { Box, Text, Button } = $.ui.resolve(e)

  const columns = Math.max(30, e.props.bodyColumns ?? 80)
  const percent = percentOf(t)
  const progressLabel = t.steps.length ? `${percent}%` : 'n/a'
  const mark = t.outcome === 'completed' ? '✓' : t.outcome === 'failed' ? '!' : t.doneAt !== null ? '…' : '✶'
  const width = Math.max(8, columns - 4 - 16 - 6 - (isCollapsed ? Math.min(30, t.title.length + 2) : 0))
  const { filled, runs } = barCells(theme, colors.bar, width, percent)
  const bar = (
    <Box>
      {runs.map(r => (
        <Text color={r.color}>{'█'.repeat(r.cells)}</Text>
      ))}
      <Text dimColor>{'░'.repeat(width - filled)}</Text>
    </Box>
  )
  const toggle = (
    <Button
      key="zen-collapse"
      plain
      dimColor
      label={isCollapsed ? '[+]' : '[–]'}
      onPress={() => update($, zenCollapsed, c => !c)}
    />
  )

  if (isCollapsed) {
    return (
      <Box borderStyle="round" borderColor={colors.border} paddingX={1} gap={1}>
        <Box width={Math.min(30, t.title.length + 2)}>
          <Text color={colors.text} bold wrap="truncate">
            {mark} {t.title}
          </Text>
        </Box>
        {bar}
        <Text color={colors.text} bold>{progressLabel.padStart(4)}</Text>
        {toggle}
      </Box>
    )
  }

  const detailsToggle = <Button key="zen-band-details" plain dimColor
    label={(await read($, controls)).details ? '[collapse details]' : '[show details]'}
    onPress={() => update($, controls, c => ({ ...c, details: !c.details }))} />
  const shown = visibleSteps(t)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1}>
      <Box justifyContent="space-between" gap={1}>
        <Text color={colors.text} bold wrap="truncate">
          {mark} {t.title}
        </Text>
        <Box gap={1} flexShrink={0}>
          <Text dimColor>{elapsed((t.doneAt ?? clock) - t.startedAt)}</Text>
          {toggle}
          {detailsToggle}
        </Box>
      </Box>
      <Box gap={1}>
        <Text dimColor>{stepLabel(t).padEnd(14)}</Text>
        {bar}
        <Text color={colors.text} bold>{progressLabel.padStart(4)}</Text>
      </Box>
      {shown.map(step => {
        const isNow = step.status === 'in_progress'
        return (
          <Box key={`step-${step.id}`} justifyContent="space-between" gap={1}>
            <Text color={isNow ? colors.text : undefined} bold={isNow} dimColor={step.status === 'pending'} wrap="truncate">
              {step.status === 'failed' ? '!' : step.status === 'blocked' ? '■' : step.status === 'completed' ? '●' : isNow ? '◉' : '○'} {step.text}
            </Text>
            <Text color={isNow ? colors.text : undefined} dimColor={!isNow}>
              {step.status === 'failed' ? 'Failed' : step.status === 'blocked' ? 'Blocked' : step.status === 'completed' ? 'Done' : isNow ? 'Working' : 'Next'}
            </Text>
          </Box>
        )
      })}
      {t.steps.length > shown.length && <Text dimColor>{t.steps.length - shown.length} more</Text>}
    </Box>
  )
}

// Moves the menu to another page; leaving the themes ends any preview.
async function goTo($: EngineInterface, panel: Panel) {
  const from = await read($, menu)
  if (from === 'themes' && panel !== 'themes') await endPreview($)
  await update($, menu, () => panel)
  if (panel === 'themes') void ensureThemes($)
  if (panel === 'agents') await refreshAgents($)
}

// Opens the menu in its pane with the keyboard, or closes it.
async function toggleMenu($: EngineInterface, panel: Panel = 'main') {
  if ((await read($, menu)) !== null) {
    // A plugin's own close skips its own ui.close hook, so reset here too.
    await $.ui.close({ id: PANE })
    await endPreview($)
    await update($, menu, () => null)
    return
  }
  await update($, menu, () => panel)
  if (panel === 'themes') void ensureThemes($)
  await $.ui.open({ id: PANE, title: MENU_NAME, focus: true, closeOnEscape: true, ...PANE_SIZE })
}

// The menu, one item per row so the arrow keys walk it top to bottom.
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>, panel: Panel) {
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return null
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const isZenOn = await read($, zenOn)
  const zenThemeNow = await read($, zenTheme)
  const level = (await read($, effort)) ?? (await read($, sessionEffort))
  const background = (await read($, paneBg)) ?? PANE_BACKGROUND
  const running = await read($, mode)
  const model = await read($, sessionModel)
  const theme = (await read($, themeName)) ?? 'Terminal default'

  // A radio row: ● for the chosen one, focusable and pressable.
  const option = (key: string, label: string, isOn: boolean, onPress: () => unknown, swatch?: string) => (
    <Box key={`row-${key}`} gap={1}>
      {swatch !== undefined && <Text color={swatch}>■</Text>}
      <Button key={key} plain label={`${isOn ? '●' : '○'} ${label}`} dimColor={!isOn} onPress={onPress} />
    </Box>
  )
  const heading = (text: string) => (
    <Box key={`h-${text}`} marginTop={1}>
      <Text bold>{text}</Text>
    </Box>
  )
  const page = (title: string, rows: RenderChildren[]) => (
    <Box
      flexDirection="column"
      paddingX={1}
      backgroundColor={background}
      width={e.props.bodyColumns}
      minHeight={e.props.scroll.bodyRows}
    >
      <Box justifyContent="space-between">
        <Text bold color="claude">
          ◆ {title}
        </Text>
        {title !== MENU_NAME && (
          <Button key="tools-back" plain dimColor hotkey="b" label="← back" onPress={() => goTo($, 'main')} />
        )}
      </Box>
      {rows}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc close</Text>
      </Box>
    </Box>
  )

  const extended = await controlPage($, e, panel)
  if (extended) return page(extended.title, extended.rows)

  if (panel === 'zen') {
    const custom = await read($, zenCustom)
    return page('Zen mode', [
      <Text key="zen-about" dimColor>
        Collapses ordinary tool details. Errors remain visible. Progress follows the actual step list.
      </Text>,
      heading('Zen mode'),
      option('zen-on', 'On', isZenOn, () => setZenOn($, true)),
      option('zen-off', 'Off', !isZenOn, () => setZenOn($, false)),
      <Button key="zen-details" plain label={(await read($, controls)).details ? 'Collapse tool details' : 'Expand tool details'}
        onPress={() => update($, controls, c => ({ ...c, details: !c.details }))} />,
      heading('Band color'),
      ...ZEN_THEMES.map(t => option(`zen-theme-${t}`, t, t === zenThemeNow, () => setZenTheme($, t), colorsFor(t, custom).bar)),
      zenThemeNow === 'custom' && (
        <Box key="zen-custom" flexDirection="column">
          {(['bar', 'text', 'border'] as const).map(part => (
            <Input
              key={`zen-color-${part}`}
              label={`${part} color`}
              value={custom[part]}
              placeholder="#3b82f6"
              submitLabel="set"
              onSubmit={value => setZenColor($, part, value)}
            />
          ))}
        </Box>
      ),
    ])
  }

  if (panel === 'themes') {
    const list = await read($, themes)
    const query = await read($, themeQuery)
    const status = await read($, themeStatus)
    const previewing = await read($, preview)
    const busy = await read($, isDownloading)
    const kept = ((await $.store.get('theme')) as { slug: string } | undefined)?.slug ?? null
    const found = list.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase()))
    if (list.length === 0) {
      return page('Theme', [
        <Text key="themes-wait" dimColor>
          {status || 'Getting the themes from terminalcolors.com…'}
        </Text>,
        !busy && <Button key="themes-download" plain label="↻ Try again" onPress={() => ensureThemes($)} />,
      ])
    }
    return page('Theme', [
      <Box key="themes-current" gap={1}>
        <Text dimColor>Kept</Text>
        <Text bold>{theme}</Text>
      </Box>,
      <Input
        key="themes-search"
        label="Search"
        value={query}
        placeholder={`${list.length} themes`}
        onInput={value => update($, themeQuery, () => value)}
        onSubmit={value => update($, themeQuery, () => value)}
      />,
      <Text key="themes-hint" dimColor>
        Arrow through the list to preview. Enter keeps one.
      </Text>,
      status !== '' && (
        <Text key="themes-status" color="claude">
          {status}
        </Text>
      ),
      found.length === 0 && (
        <Text key="themes-none" dimColor>
          No theme matches “{query}”.
        </Text>
      ),
      ...found.map(t => (
        <Button
          key={`theme:${t.slug}`}
          plain
          autoFocus={t.slug === (previewing ?? kept) ? true : undefined}
          label={`${t.slug === kept ? '●' : t.slug === previewing ? '◉' : '○'} ${t.name}`}
          dimColor={t.slug !== kept && t.slug !== previewing}
          onPress={themeAction($, () => applyTheme($, t.slug))}
        />
      )),
      heading('More'),
      <Button
        key="themes-reset"
        plain
        dimColor
        label="Back to Claude Code's previous theme"
        onPress={themeAction($, () => applyTheme($, null))}
      />,
      <Button key="themes-refresh" plain dimColor label="Download the themes again" onPress={themeAction($, () => downloadThemes($))} />,
    ])
  }

  if (panel === 'status') {
    const isOn = await read($, statusOn)
    return page('Status line', [
      <Text key="status-about" dimColor>
        Model, folder and branch, then context, 5h and 7d limits and cache, with dev-control on the same row.
      </Text>,
      heading('Status line'),
      option('status-on', 'On', isOn, () =>
        setStatusOn($, true).catch((error: unknown) => $.ui.toast(`Could not turn it on: ${String(error)}`)),
      ),
      option('status-off', 'Off', !isOn, () =>
        setStatusOn($, false).catch((error: unknown) => $.ui.toast(`Could not turn it off: ${String(error)}`)),
      ),
      <Text key="status-note" dimColor>
        On takes your own statusLine command out of settings.json; Off puts it back.
      </Text>,
    ])
  }

  if (panel === 'mode') {
    // Marked: what this session runs in, until a new-session mode is chosen here.
    const next = (await read($, defaultModeChosen)) ? await read($, defaultMode) : (running ?? (await read($, defaultMode)))
    const family = modelFamily(model)
    return page('Mode', [
      heading('Model'),
      ...MODELS.map(m =>
        option(`model-${m.alias}`, m.label, m.alias === family, () =>
          setModel($, m.alias).catch((error: unknown) => $.ui.toast(`Could not switch the model: ${String(error)}`)),
        ),
      ),
      <Button
        key="model-default"
        plain
        dimColor
        label="↺ Claude Code's default"
        onPress={() =>
          setModel($, 'default').catch((error: unknown) => $.ui.toast(`Could not switch the model: ${String(error)}`))
        }
      />,
      heading('Effort'),
      ...EFFORTS.map(l => option(`effort-${l}`, l, l === level, () => setEffort($, l))),
      <Button key="effort-inherit" plain label="Use Claude Code's own effort" onPress={() => update($, effort, () => null)} />,
      <Button key="effort-subagents" plain label={(await read($, effortForSubagents)) ? '● Override subagent effort too (session)' : '○ Preserve each subagent effort'}
        onPress={() => update($, effortForSubagents, value => !value)} />,
      heading('Running in'),
      <Text key="mode-running">
        {running === null ? (
          'Shown after your next prompt'
        ) : (
          <Text color={MODE_COLORS[running] ?? 'text'}>{modeLabel(running)}</Text>
        )}
        <Text dimColor> · shift+tab switches it</Text>
      </Text>,
      heading('New sessions start in'),
      ...MODES.map(m => (
        <Box key={`row-default-mode-${m}`} gap={1}>
          <Button
            key={`default-mode-${m}`}
            plain
            label={m === next ? '●' : '○'}
            onPress={() =>
              setDefaultMode($, m).catch((error: unknown) => $.ui.toast(`Could not save the mode: ${String(error)}`))
            }
          />
          <Text color={MODE_COLORS[m] ?? 'text'} bold={m === next}>
            {modeLabel(m)}
          </Text>
          {m === running && <Text dimColor>· now</Text>}
        </Box>
      )),
      next === 'bypassPermissions' && (
        <Text key="mode-warning" color="warning">
          Bypass skips every permission check. Claude Code asks you to confirm it when the next session starts.
        </Text>
      ),
    ])
  }

  const row = (hotkey: string, name: string, value: string, target: Panel) => (
    <Box key={`row-${target}`} flexDirection="column" marginTop={1}>
      <Button
        key={`open-${target}`}
        plain
        hotkey={hotkey}
        autoFocus={target === 'zen' ? true : undefined}
        label={`${name}  ›`}
        onPress={() => goTo($, target)}
      />
      <Text dimColor>   {value}</Text>
    </Box>
  )
  return page(MENU_NAME, [
    row('1', 'Zen mode', isZenOn ? `on · ${zenThemeNow} band` : 'off', 'zen'),
    row('2', 'Theme', theme, 'themes'),
    row(
      '3',
      'Mode',
      `${model === null ? '' : `${prettyModel(model)} · `}${running === null ? '—' : modeLabel(running)} · effort ${level ?? 'default'}`,
      'mode',
    ),
    row('4', 'Status line', (await read($, statusOn)) ? 'on' : 'off', 'status'),
    row('5', 'Usage monitor', 'context · account limits · handoff', 'usage'),
    row('6', 'Notifications', 'terminal · sound · desktop', 'notifications'),
    row('7', 'Profiles', (await read($, controls)).profileScope, 'profiles'),
    row('8', 'Agents', 'actual status · observed results', 'agents'),
  ])
}

// The row under the prompt: with the status line on, the status line with the
// dev-control button at its end, and under it, while Claude has a background
// shell or monitor running, the engine's pill for them; otherwise the hint and
// the button.
// The engine's hint, on one row: it can carry a second line holding only a
// separator, which drew as a stray dot under the hint.
function hintText(hint: string) {
  return hint
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /[\p{L}\p{N}]/u.test(line))
    .join(' · ')
}

async function drawPromptHint($: EngineInterface, e: RenderInput<'PromptHint'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isOpen = (await read($, menu)) !== null
  const label = `◆ ${MENU_NAME} ${isOpen ? '▼' : '▲'}`
  const button = <Button key="tools-toggle" plain label={label} onPress={() => toggleMenu($)} />
  const snapshot = (await read($, statusOn)) ? await read($, status) : null

  // The engine keeps its mode label (⏵⏵ auto mode on ·) in a column of its own
  // to the left of this tree, so the tree grows into the rest of one row: a
  // full-width or multi-row tree wraps that label and pushes everything right.
  if (snapshot === null) {
    return (
      <Box justifyContent="space-between" flexGrow={1} gap={1}>
        <Text dimColor wrap="truncate">
          {hintText(e.props.hint)}
        </Text>
        {button}
      </Box>
    )
  }

  const now = await read($, statusClock)
  const cache = cacheState(await read($, lastResponseAt), now)
  const columns = e.viewport?.columns ?? 120
  const sep = <Text dimColor>{'  │  '}</Text>
  const bar = (percent: number, color: string) => (
    <Text>
      <Text color={color}>{'█'.repeat(barFill(percent))}</Text>
      <Text dimColor>{'░'.repeat(BAR_WIDTH - barFill(percent))}</Text>{' '}
    </Text>
  )

  const ctxPercent = Math.round(snapshot.ctxPercent ?? 0)
  const ctxLabel = snapshot.ctxPercent === null ? 'n/a' : `${ctxPercent}%${(await read($, controls)).usageError ? '~' : ''}`
  const ctxTokens =
    snapshot.ctxTokens === null ? '' : ` ${fmtTokens(snapshot.ctxTokens)}${snapshot.ctxWindow ? `/${fmtTokens(snapshot.ctxWindow)}` : ''}`
  const limits = snapshot.limits.map(l => ({
    ...l,
    percentText: `${Math.round(l.percent)}%`,
    resetText: l.resetsAt === null ? '' : ` (resets ${fmtDuration(l.resetsAt - now)})`,
  }))
  const cacheText = cache === null ? '' : `● cache ~${cache}`
  const model = prettyModel(snapshot.model)
  const head = `${model} · ${snapshot.dir}${snapshot.branch === '' ? '' : ` · ${snapshot.branch}`}`
  // One row beside the engine's mode label (about MODE_LABEL_COLUMNS wide):
  // the most detailed level that leaves room for the button; past the least
  // detailed one, the model and folder go too.
  const room = columns - MODE_LABEL_COLUMNS - label.length - 4
  const fits = (d: Detail, withHead: boolean) =>
    statsWidth(`${ctxLabel}${ctxTokens}`, limits, cacheText, d) + (withHead ? head.length + 5 : 0) <= room
  const showHead = fits(2, true)
  const detail: Detail = ([0, 1, 2] as const).find(d => fits(d, showHead)) ?? 2

  const stats = [
    showHead && (
      <Text key="head">
        <Text color={STATUS_CYAN}>{model}</Text>
        <Text dimColor> · </Text>
        <Text>{snapshot.dir}</Text>
        {snapshot.branch !== '' && <Text dimColor> · </Text>}
        {snapshot.branch !== '' && <Text color={STATUS_GREEN}>{snapshot.branch}</Text>}
        {sep}
      </Text>
    ),
    <Text key="ctx">
      <Text>ctx </Text>
      {detail === 0 && snapshot.ctxPercent !== null && bar(ctxPercent, colorFor(ctxPercent))}
      <Text bold color={colorFor(ctxPercent)}>{ctxLabel}</Text>
      <Text dimColor>{ctxTokens}</Text>
    </Text>,
    ...limits.map(l => (
      <Text key={`limit-${l.label}`}>
        {sep}
        <Text>{l.label} </Text>
        {detail === 0 && bar(l.percent, colorFor(l.percent))}
        <Text bold color={colorFor(l.percent)}>{l.percentText}</Text>
        {detail < 2 && <Text dimColor>{l.resetText}</Text>}
      </Text>
    )),
    cache !== null && (
      <Text key="cache">
        {sep}
        <Text color={cache === 'ok' ? STATUS_GREEN : STATUS_RED}>●</Text>
        <Text dimColor> cache ~{cache}</Text>
      </Text>
    ),
  ]

  const statsRow = (
    <Box justifyContent="space-between" flexGrow={1} gap={1}>
      <Text wrap="truncate">{stats}</Text>
      {button}
    </Box>
  )
  // The status line takes the hint's place, pill and all, so the pill gets a
  // row of its own under it. Still no wider than the space the label leaves.
  const pill = backgroundPill(e.props.hint)
  if (pill === null) return statsRow
  return (
    <Box flexDirection="column" flexGrow={1}>
      {statsRow}
      <Box gap={1}>
        <Button key="background-tasks" plain label={`⎿ ${pill}`} onPress={() => openTasks($)} />
        <Text dimColor wrap="truncate">
          · /tasks to manage
        </Text>
      </Box>
    </Box>
  )
}

async function openTasks($: EngineInterface) {
  try {
    await $.command.run({ command: 'tasks' })
  } catch (error) {
    $.ui.toast(`Could not open /tasks: ${String(error)}`)
  }
}

// `claude-opus-5-5` (what $.session.model() gives) as `Opus 5.5`; a name
// that is not a Claude model id stays as it is.
function prettyModel(id: string) {
  const match = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i)
  if (match === null) return id
  const [, family = '', major = '', minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

// The status line's clock: reset countdowns and the cache state move with it.
let statusTicker: Timer | undefined

// Zen's elapsed-time ticker, one per module load.
let ticker: Timer | undefined

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

// Puts a fresh task on the band and starts its clock.
async function startTask($: EngineInterface, title: string) {
  const startedAt = await $.clock.now()
  const fresh: ZenTask = { title: title || 'Working', startedAt, doneAt: null, steps: [], outcome: 'running' }
  await update($, task, () => fresh)
  await update($, now, () => startedAt)
  stopTicker()
  ticker = $.clock.every(1000, () => {
    void $.clock.now().then(t => update($, now, () => t))
  })
}

// Hooks ------------------------------------------------------------------------

// Watching hooks end in .catch(... next(e)): when one fails, the event goes on.

export const register: Register = on => {
  registerController(on)

  on('session.end', async ($, e, next) => {
    statusTicker?.cancel()
    statusTicker = undefined
    stopTicker()
    // A preview left open as the session ends gives way to the kept theme,
    // and this tab's Windows Terminal profile gets its own colors back.
    try {
      await endPreview($)
      if (await isWindows($)) await paintWindowsTerminal($, null)
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadSettings($)
    await loadControl($).catch(error => $.ui.toast(`Profile could not be loaded: ${String(error)}`))
    await loadThemes($)
    await loadStatus($)
    await loadSessionEffort($)
    try {
      await trackModel($, await $.session.model())
    } catch {}
    await refreshPaneBg($)
    statusTicker?.cancel()
    statusTicker = $.clock.every(15_000, () => {
      void update($, statusClock, () => Date.now())
      void pollControl($).catch(() => {})
    })
    try {
      await $.tool.register({ name: ZEN_TOOL_NAME, description: ZEN_TOOL_DESCRIPTION, inputSchema: ZEN_TOOL_SCHEMA })
    } catch {}
    await $.command.register({
      name: 'dev-control',
      description: 'Open Dev Control: usage, notifications, Zen, themes, profiles and agents',
      argumentHint: '[zen|themes|mode|usage|notifications|profiles|agents|handoff|debug]',
      immediate: true,
    })
    return started
  })

  on('command.run', { command: 'dev-control' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'debug') {
      const rows = await $.config.list()
      return { text: rows.map(r => `${r.key} (${r.kind}) = ${JSON.stringify(r.value)}`).join('\n') }
    }
    if (arg === 'handoff') { await queueHandoff($); return { text: 'Handoff request prepared in your draft.' } }
    const panel: Panel = ['zen', 'themes', 'mode', 'status', 'usage', 'notifications', 'profiles', 'agents'].includes(arg) ? arg as Panel : 'main'
    if (panel === 'agents') await refreshAgents($)
    if ((await read($, menu)) !== null) await goTo($, panel)
    else await toggleMenu($, panel)
    return { text: 'dev-control is open.' }
  })

  // The menu's pane.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const panel = await read($, menu)
    const drawn = panel === null ? null : await drawPane($, e, panel)
    return drawn ?? $.ui.resolve(e).Text({ children: '' })
  })

  // However the pane closes (esc, its close mark, the corner button), the menu
  // resets and an unkept theme preview is undone.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await endPreview($)
    await update($, menu, () => null)
    return closed
  }).catch(($, e, next) => next(e))

  // Themes: the focus ring landing on a theme previews it on the terminal,
  // once the arrows rest for a moment (each preview rewrites the terminal's settings).
  let previewTimer: Timer | undefined
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    const slug = e.element?.startsWith('theme:') ? e.element.slice('theme:'.length) : null
    previewTimer?.cancel()
    if (slug !== null && slug !== (await read($, preview))) {
      previewTimer = $.clock.after(250, () => {
        void previewTheme($, slug).catch((error: unknown) =>
          sayTheme($, `Preview failed: ${error instanceof Error ? error.message : String(error)}`),
        )
      })
    }
    return moved
  }).catch(($, e, next) => next(e))

  // Themes: each wheel tick over the pane steps the preview to the next or
  // previous theme in the list (the list scrolls along as usual).
  let wheelSlug: string | null = null
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (e.pointer === undefined || e.by === 0 || (await read($, menu)) !== 'themes') return moved
    const query = (await read($, themeQuery)).trim().toLowerCase()
    const found = (await read($, themes)).filter(t => t.name.toLowerCase().includes(query))
    if (found.length === 0) return moved
    const kept = ((await $.store.get('theme')) as { slug: string } | undefined)?.slug ?? null
    const current = wheelSlug ?? (await read($, preview)) ?? kept
    const at = found.findIndex(t => t.slug === current)
    const target = found[Math.max(0, Math.min(found.length - 1, at + Math.sign(e.by)))]
    if (target === undefined) return moved
    wheelSlug = target.slug
    void $.ui.focus({ requestId: PANE, key: `theme:${target.slug}` }).catch(() => {})
    previewTimer?.cancel()
    previewTimer = $.clock.after(250, () => {
      wheelSlug = null
      void previewTheme($, target.slug).catch((error: unknown) =>
        sayTheme($, `Preview failed: ${error instanceof Error ? error.message : String(error)}`),
      )
    })
    return moved
  }).catch(($, e, next) => next(e))

  // The corner button and, when on, the status line, under the prompt.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => drawPromptHint($, e))

  // The band above the prompt: Zen's progress.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    return (await drawZenBand($, e)) ?? next(e)
  })

  // Collapse routine details; failures, denials and interruptions remain inspectable.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) =>
    (await read($, zenOn)) && !(await read($, controls)).details && !e.props.isErrored && !e.props.isInterrupted && !hasFailure(e.props.output)
      ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) =>
    (await read($, zenOn)) && !(await read($, controls)).details && !e.props.isErrored && !hasFailure(e.props.output)
      ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) =>
    (await read($, zenOn)) && !(await read($, controls)).details && !e.props.calls.some(call => call.isErrored || call.isInterrupted || hasFailure(call.output))
      ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, zenOn)) && !(await read($, controls)).details ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )

  // Zen: asks Claude to narrate and keep a task list the band can follow.
  // Zen: each prompt typed starts a new task on the band, and carries the Zen
  // instructions for Claude (read with the prompt, never shown).
  let lastPrompt = ''

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const isTyped = e.origin.kind === 'composer' && text !== '' && !text.startsWith('/')
    if (!isTyped) return next(e)
    lastPrompt = (text.split('\n')[0] ?? '').slice(0, 200)
    if (!(await read($, zenOn))) return next(e)
    await startTask($, lastPrompt)
    return next({ ...e, context: [...(e.context ?? []), ZEN_PROMPT] })
  }).catch(($, e, next) => next(e))

  // Zen: Claude's own progress tool. Each call sends the whole step list.
  on('tool.call', { tool: ZEN_TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'Subagent progress does not replace the main task.' }
    const input = e as unknown as { title?: unknown; steps?: unknown; outcome?: unknown }
    const steps: ZenStep[] = (Array.isArray(input.steps) ? input.steps : []).flatMap((raw: unknown, i) => {
      const step = raw as { text?: unknown; status?: unknown }
      return typeof step.text === 'string' ? [{ id: `zen-${i}`, text: step.text, status: asStatus(step.status) }] : []
    })
    if ((await read($, task)) === null) await startTask($, lastPrompt)
    await update($, task, t =>
      t === null ? t : { ...t, title: typeof input.title === 'string' && input.title !== '' ? input.title : t.title, steps,
        outcome: input.outcome === 'waiting' || input.outcome === 'failed' || input.outcome === 'interrupted' ? input.outcome :
          input.outcome === 'completed' && steps.length > 0 && steps.every(s => s.status === 'completed') ? 'completed' : 'running' },
    )
    const t = await read($, task)
    const done = steps.filter(s => s.status === 'completed').length
    return { result: `Progress band updated: ${done} of ${steps.length} steps done (${t === null ? 0 : percentOf(t)}%).` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny || ran.isError) return ran
    const steps: ZenStep[] = e.todos.map((todo, i) => ({
      id: `todo-${i}`,
      text: todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content,
      status: asStatus(todo.status),
    }))
    await update($, task, t => (t === null ? t : { ...t, steps }))
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    if (id !== undefined) {
      const step: ZenStep = { id, text: e.subject, status: 'pending' }
      await update($, task, t => (t === null ? t : { ...t, steps: [...t.steps.filter(s => s.id !== id), step] }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    if (ran.deny !== undefined || ran.isError === true) return ran
    await update($, task, t => {
      if (t === null) return t
      if (e.status === 'deleted') return { ...t, steps: t.steps.filter(s => s.id !== e.taskId) }
      const steps = t.steps.map(s =>
        s.id === e.taskId ? { ...s, text: e.subject ?? s.text, status: e.status ? asStatus(e.status) : s.status } : s,
      )
      return { ...t, steps }
    })
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) {
      await trackAgent($, e.agentId, { status: e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed',
        result: e.answer.slice(0, 1000), endedAt: Date.now() }).catch(() => {})
      return ran
    }
    stopTicker()
    const current = await read($, task)
    if (current !== null && current.doneAt === null) {
      const doneAt = await $.clock.now()
      const finished = { ...finishTask(current, e.reason), doneAt }
      await update($, task, () => finished)
      await update($, now, () => doneAt)
      if (finished.outcome === 'completed') $.clock.after(8000, () => {
        void update($, task, t => (t !== null && t.doneAt === doneAt ? null : t))
      })
    }
    if (e.reason === 'error' || e.reason === 'refusal') void notify($, 'error', 'Response issue', 'The main response ended with an error or refusal.')
    else if (e.reason === 'answer') void notify($, 'finished', 'Response finished', 'The main response finished. Check pending steps before treating the task as complete.')
    void refreshStatus($).catch(() => {})
    return ran
  })

  // Mode: the chosen effort rides on every model request of the session; the
  // main loop's model is noted for the Mode page.
  on('turn.step', async function* ($, e, next) {
    const level = await read($, effort)
    // The session's own level, as the engine would send it, before ours replaces it.
    if (e.agentId === undefined) {
      await trackEffort($, e.effort)
      await trackModel($, e.model)
    }
    const wanted = overrideEffort(e.agentId, e.effort, level, await read($, effortForSubagents))
    const answered = yield* next(wanted !== e.effort ? { ...e, effort: wanted } : e)
    if (e.agentId !== undefined) {
      await trackAgent($, e.agentId, { model: e.model, effort: wanted === undefined ? undefined : String(wanted), status: 'running' }).catch(() => {})
    }
    // The main loop's responses keep the prompt cache warm; subagents' do not.
    if (e.agentId === undefined && answered.usage !== null) {
      const at = Date.now()
      await update($, lastResponseAt, () => at)
      await update($, statusClock, () => at)
      void refreshStatus($).catch(() => {})
    }
    return answered
  })

  // Mode: the running permission mode, as the engine reports it to hooks.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostToolUse', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    // With an override of ours this reports ours, so only record without one.
    if ((await read($, effort)) === null) await trackEffort($, e.effort?.level)
    return next(e)
  }).catch(($, e, next) => next(e))
}


export async function sendNotice($: EngineInterface, settings: NoticeSettings, title: string, message: string): Promise<string> {
  const results: string[] = []
  const pending: Promise<void>[] = []
  if (settings.terminal) {
    try { $.ui.toast(`${title}: ${message}`, { timeoutMs: 8000 }); results.push('terminal: sent') }
    catch { results.push('terminal: unavailable') }
  }
  if (settings.sound) pending.push((async () => {
    try { await $.audio.play({ asset: 'assets/notice.wav' }); results.push('sound: sent') }
    catch { results.push('sound: unavailable') }
  })())
  if (settings.desktop) pending.push((async () => {
    try {
      const windows = (await $.env.get('OS')) === 'Windows_NT' || !!(await $.env.get('WSL_DISTRO_NAME'))
      let platform: 'windows' | 'mac' | 'linux' = windows ? 'windows' : 'linux'
      if (!windows) {
        const system = await $.process.run(['uname', '-s'], { timeoutMs: 2000 })
        if (system.stdout.trim() === 'Darwin') platform = 'mac'
      }
      const cmd = desktopCommand(platform, title, message)
      const r = await $.process.run(cmd.argv, { env: cmd.env, timeoutMs: 5000 })
      results.push(r.exitCode === 0 ? 'desktop: command accepted' : 'desktop: unavailable')
    } catch { results.push('desktop: unavailable') }
  })())
  await Promise.all(pending)
  return results.length ? results.join(' · ') : 'All notification channels are off'
}


export async function loadControl($: EngineInterface) {
  let root: string
  try { root = await $.session.root() } catch { root = await $.session.cwd() }
  root = normalizeRoot(root)
  await update($, controls, () => ({ ...initialControl(), root }))
  const chosen = resolveProfile(await $.store.get(`profile:${root}`), await $.store.get('globalProfile'), root)
  if (chosen.profile) {
    await update($, controls, c => ({ ...c, notices: chosen.profile!.notices, profileScope: chosen.scope }))
    await applyProfile($, chosen.profile)
  }
}
export async function saveProfile($: EngineInterface, scope: 'project' | 'global') {
  const c = await read($, controls)
  const profile: Profile = { version: 1, ...(scope === 'project' ? { root: c.root } : {}),
    ...await captureProfile($), notices: normalizeNotices(c.notices) }
  await $.store.set(scope === 'project' ? `profile:${c.root}` : 'globalProfile', profile)
  await update($, controls, state => ({ ...state, profileScope: scope }))
  $.ui.toast(`Saved ${scope} profile. It will be restored in new sessions.`)
}
export async function clearProfile($: EngineInterface, scope: 'project' | 'global') {
  const c = await read($, controls)
  await $.store.delete(scope === 'project' ? `profile:${c.root}` : 'globalProfile')
  await update($, controls, state => ({ ...state, profileScope: 'session' }))
  $.ui.toast(`Removed ${scope} profile. Current session settings are unchanged.`)
}
export async function queueHandoff($: EngineInterface) {
  const draft = await $.prompt.read()
  if (draft.text.includes(HANDOFF_PROMPT)) { $.ui.toast('Handoff request is already in your draft'); return }
  const r = await $.prompt.fill({ text: `${draft.text ? '\n\n' : ''}${HANDOFF_PROMPT}`, mode: 'append' })
  $.ui.toast(r.isFilled ? 'Handoff request added to your draft. Press Enter to send.' : 'No prompt box available; use the handoff request from the README.')
}

// Diagnostic failures never change model results, tool results or permissions.
export async function notify($: EngineInterface, kind: NoticeKind, title: string, message: string, force = false) {
  try {
    const c = await read($, controls)
    const enabled = kind === 'usage' || kind === 'finished' && c.notices.finished || kind === 'error' && c.notices.errors || kind === 'waiting' && c.notices.waiting
    if (!force && !enabled) return
    if (!c.notices.terminal && !c.notices.sound && !c.notices.desktop) return
    // Keep separate cooldowns, so a usage alert cannot suppress an error or a permission request.
    const key = `lastNotice:${await $.session.id()}:${kind}`
    const last = await $.store.get(key)
    const at = await $.clock.now()
    if (!force && kind !== 'usage' && typeof last === 'number' && at - last < c.notices.cooldownSeconds * 1000) return
    await $.store.set(key, at)
    const delivery = await sendNotice($, c.notices, title, message)
    await update($, controls, state => ({ ...state, delivery }))
  } catch { /* Notifications are best effort; never block the user's work. */ }
}
export async function checkUsage($: EngineInterface, metrics: Metric[]) {
  const c = await read($, controls)
  if (!c.notices.terminal && !c.notices.sound && !c.notices.desktop) return
  const selected = metrics.filter(m => m.id === 'context' ? c.notices.context : c.notices.limits)
  const id = await $.session.id()
  const raw = await $.store.get(`usageLedger:${id}`)
  const ledger = raw && typeof raw === 'object' ? raw as Ledger : {}
  const checked = crossedThresholds(selected, ledger, c.notices.thresholds)
  if (checked.alerts.length) {
    await $.store.set(`usageLedger:${id}`, checked.ledger)
    await notify($, 'usage', 'Usage warning', checked.alerts.join(' · '))
  } else {
    await $.store.set(`usageLedger:${id}`, checked.ledger)
  }
}
export async function refreshAgents($: EngineInterface) {
  try {
    const listed = await $.agent.list()
    await update($, controls, c => ({ ...c, agentsError: null, agents: listed.map(a => ({ ...c.agents.find(old => old.id === a.id), ...a })) }))
  } catch {
    await update($, controls, c => ({ ...c, agentsError: 'Agent listing unavailable in this host. Existing rows may be stale.' }))
  }
}
export async function trackAgent($: EngineInterface, id: string, patch: Partial<AgentRow>) {
  await update($, controls, c => {
    const existing = c.agents.find(a => a.id === id)
    const row: AgentRow = { id, description: '', type: 'subagent', status: 'unknown', ...existing, ...patch }
    return { ...c, agents: [...c.agents.filter(a => a.id !== id), row].slice(-100) }
  })
}

export function registerController(on: Parameters<Register>[0]) {
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.agentId) await trackAgent($, ran.agentId, { description: e.description || e.subagentType,
      type: e.subagentType, status: 'running', model: ran.model, startedAt: Date.now() }).catch(() => {})
    return ran
  })
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog' || e.notification_type === 'idle_prompt') {
      void notify($, 'waiting', 'Input needed', 'Claude Code is waiting for your input.').catch(() => {})
    }
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError || ran.deny) void notify($, 'error', 'Tool issue', `${e.tool} reported an error or was denied. Expand details to inspect it.`)
    return ran
  })
}

export async function controlPage($: EngineInterface, e: RenderInput<'Pane'>, panel: Panel): Promise<{ title: string; rows: RenderChildren[] } | null> {
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return null
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const c = await read($, controls)
  const run = (work: () => Promise<unknown>) => () => work().catch(error => $.ui.toast(`Dev Control: ${String(error)}`))
  const toggle = (key: keyof NoticeSettings, label: string) => <Button key={`notice-${key}`} plain
    label={`${c.notices[key] ? '●' : '○'} ${label}`}
    onPress={() => update($, controls, state => ({ ...state, notices: { ...state.notices, [key]: !state.notices[key] } }))} />
  if (panel === 'notifications') return { title: 'Notifications', rows: [
    <Text key="notice-help" dimColor>Configure channels and events. Save a profile to keep these settings.</Text>,
    toggle('terminal', 'Terminal notice'), toggle('sound', 'Sound'), toggle('desktop', 'Desktop notification'),
    <Text key="notice-events" bold>Events</Text>,
    toggle('context', 'Context thresholds'), toggle('limits', '5h / 7d thresholds'),
    toggle('finished', 'Main response finished'), toggle('errors', 'Tool / response errors'), toggle('waiting', 'Waiting for input'),
    <Input key="notice-thresholds" label="Thresholds (%)" value={c.notices.thresholds.join(', ')} placeholder="70, 85, 95" submitLabel="set"
      onSubmit={text => { const thresholds = parseThresholds(text); if (!thresholds) { $.ui.toast('Use 1–6 comma-separated integers from 1 to 100'); return }
        return update($, controls, state => ({ ...state, notices: { ...state.notices, thresholds } })) }} />,
    <Input key="notice-refresh" label="Minimum reading interval (seconds, 15–300)" value={String(c.notices.refreshSeconds)} submitLabel="set"
      onSubmit={text => { const n = Number(text); if (!Number.isInteger(n) || n < 15 || n > 300) { $.ui.toast('Enter an integer from 15 to 300'); return }
        return update($, controls, state => ({ ...state, notices: { ...state.notices, refreshSeconds: n } })) }} />,
    <Input key="notice-cooldown" label="Other event cooldown (seconds, 5–600)" value={String(c.notices.cooldownSeconds)} submitLabel="set"
      onSubmit={text => { const n = Number(text); if (!Number.isInteger(n) || n < 5 || n > 600) { $.ui.toast('Enter an integer from 5 to 600'); return }
        return update($, controls, state => ({ ...state, notices: { ...state.notices, cooldownSeconds: n } })) }} />,
    <Button key="notice-test" plain label="Send test notification" onPress={run(() => notify($, 'usage', 'Dev Control', 'Test notification', true))} />,
    <Text key="notice-delivery" dimColor>{c.delivery || 'Desktop delivery depends on your OS and notification settings.'}</Text>,
  ] }
  const usage = await read($, status)
  if (panel === 'usage') return { title: 'Usage monitor', rows: [
    <Text key="usage-help" dimColor>Context is conversation size. 5h / 7d are account limits from the last API response.</Text>,
    <Text key="usage-context">Context: {usage?.ctxPercent == null ? 'unavailable' : `${Math.round(usage.ctxPercent)}%`}{usage?.ctxTokens == null ? '' : ` · ${fmtTokens(usage.ctxTokens)} tokens`}</Text>,
    ...(['5h', '7d'] as const).map(label => { const window = usage?.limits.find(l => l.label === label); return <Text key={`usage-${label}`}>{label} account limit: {window ? `${Math.round(window.percent)}% used${window.resetsAt === null ? '' : ` · resets in ${fmtDuration(window.resetsAt - Date.now())}`}` : 'unavailable'}</Text> }),
    <Text key="usage-age">{c.usageAt === null ? 'No successful reading yet' : `Readings checked ${Math.max(0, Math.floor(((await $.clock.now()) - c.usageAt) / 1000))}s ago`}</Text>,
    <Text key="usage-error" color={c.usageError ? 'warning' : undefined}>{c.usageError || 'No exact remaining-message estimate is available.'}</Text>,
    <Button key="usage-refresh" plain label={c.busy ? 'Checking…' : 'Refresh now'} onPress={run(() => refreshStatus($))} />,
    <Button key="handoff" plain label="Prepare handoff request" onPress={run(() => queueHandoff($))} />,
    <Text key="handoff-help" dimColor>Adds a request to your draft; sends nothing until you press Enter.</Text>,
    <Text key="cache-help" dimColor>Cache age is a time estimate; it does not confirm a cache hit.</Text>,
  ] }
  if (panel === 'profiles') return { title: 'Profiles', rows: [
    <Text key="profile-root" wrap="truncate">Project: {c.root || 'unknown'}</Text>,
    <Text key="profile-scope">Loaded scope: {c.profileScope}. Save a profile to restore these controls in future sessions.</Text>,
    <Text key="profile-help" dimColor>Saves model, effort, Zen, theme and notifications. Project overrides global. Permissions use Claude Code's own controls.</Text>,
    <Button key="profile-project" plain label="Save for this project" onPress={run(() => saveProfile($, 'project'))} />,
    <Button key="profile-global" plain label="Save as global default" onPress={run(() => saveProfile($, 'global'))} />,
    <Button key="profile-remove-project" plain label="Remove saved project profile" onPress={run(() => clearProfile($, 'project'))} />,
    <Button key="profile-remove-global" plain label="Remove saved global profile" onPress={run(() => clearProfile($, 'global'))} />,
  ] }
  if (panel === 'agents') {
    const filter = c.agentFilter.toLowerCase()
    const rows = c.agents.filter(a => `${a.id} ${a.name || ''} ${a.type} ${a.description} ${a.status}`.toLowerCase().includes(filter))
    const selected = c.agents.find(a => a.id === c.selectedAgent)
    return { title: 'Agents', rows: [
      <Text key="agent-help" dimColor>Actual engine records; this panel never starts agents. Model, effort and results appear when observed.</Text>,
      <Text key="agent-count">{c.agents.filter(a => a.status === 'running').length} running · {c.agents.length} observed</Text>,
      <Button key="agents-refresh" plain label="Refresh agents" onPress={run(() => refreshAgents($))} />,
      <Button key="agents-tasks" plain label="Open native /tasks" onPress={run(() => openTasks($))} />,
      <Input key="agents-filter" label="Filter" value={c.agentFilter} submitLabel="filter"
        onSubmit={agentFilter => update($, controls, state => ({ ...state, agentFilter }))} />,
      c.agentsError && <Text key="agents-error" color="warning">{c.agentsError}</Text>,
      rows.length === 0 && <Text key="agents-empty" dimColor>No matching agents observed.</Text>,
      ...rows.slice(-12).map(a => <Box key={`agent-${a.id}`} flexDirection="column">
        <Button key={`agent-select-${a.id}`} plain label={`${a.name || a.type} · ${a.status} · ${a.id.slice(0, 10)}`}
          onPress={() => update($, controls, state => ({ ...state, selectedAgent: state.selectedAgent === a.id ? null : a.id }))} />
        <Text dimColor wrap="truncate">{a.description || 'Task description unavailable'}</Text>
      </Box>),
      rows.length > 12 && <Text key="agents-more" dimColor>Showing latest 12 matching agents; use filter to find others.</Text>,
      selected && <Box key="agent-details" flexDirection="column">
        <Text bold>{selected.name || selected.type} · {selected.status}</Text>
        <Text dimColor>{selected.model || 'Model not observed'} · effort {selected.effort || 'not observed'}{selected.parentId ? ` · parent ${selected.parentId}` : ''}</Text>
        <Text>{selected.result || 'Result not observed in this session.'}</Text>
      </Box>,
    ] }
  }
  return null
}
