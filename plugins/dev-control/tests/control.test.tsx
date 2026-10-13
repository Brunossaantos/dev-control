import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { crossedThresholds, parseThresholds, normalizeNotices, DEFAULT_NOTICES, finishTask, overrideEffort,
  normalizeRoot, resolveProfile, normalizeProfile, desktopCommand, HANDOFF_PROMPT } from '../hooks/lib/control'
import { percentOf, stepLabel } from '../hooks/lib/zen'
import type { Profile, ZenTask } from '../types'

const profile: Profile = { version: 1, root: '/project', model: 'sonnet', effort: 'high', zenOn: true,
  zenTheme: 'blue', theme: null, notices: DEFAULT_NOTICES }
const task: ZenTask = { title: 'Fix', startedAt: 0, doneAt: null,
  steps: [{ id: '1', text: 'Read', status: 'completed' }, { id: '2', text: 'Verify', status: 'pending' }] }
describe('usage thresholds', () => {
  test('validates, sorts and deduplicates thresholds', () => {
    expect(parseThresholds('95, 70, 85, 70')).toEqual([70, 85, 95])
    for (const bad of ['', '0', '101', '70,,85', '70.5', '70, nope']) expect(parseThresholds(bad)).toBe(null)
  })
  test('jumping several bands sends one highest-band warning', () => {
    const r = crossedThresholds([{ id: '5h', label: '5h', percent: 96, cycle: 'a' }], {}, [70, 85, 95])
    expect(r.alerts).toEqual(['5h: 96% (alert 95%)'])
    expect(r.ledger['5h'].sent).toEqual([70, 85, 95])
    expect(crossedThresholds([{ id: '5h', label: '5h', percent: 99, cycle: 'a' }], r.ledger, [70, 85, 95]).alerts).toEqual([])
  })
  test('warns independently for account windows', () => {
    const r = crossedThresholds([{ id: '5h', label: '5h', percent: 71, cycle: 'a' }, { id: '7d', label: '7d', percent: 86, cycle: 'b' }], {}, [70, 85, 95])
    expect(r.alerts.length).toBe(2)
  })
  test('rearms on a new account window', () => {
    const first = crossedThresholds([{ id: '5h', label: '5h', percent: 75, cycle: 'a' }], {}, [70])
    const next = crossedThresholds([{ id: '5h', label: '5h', percent: 75, cycle: 'b' }], first.ledger, [70])
    expect(next.alerts.length).toBe(1)
  })
  test('context compaction rearms alerts; small corrections do not', () => {
    let r = crossedThresholds([{ id: 'context', label: 'ctx', percent: 88, cycle: 's' }], {}, [70, 85])
    r = crossedThresholds([{ id: 'context', label: 'ctx', percent: 84, cycle: 's' }], r.ledger, [70, 85])
    expect(r.alerts.length).toBe(0)
    r = crossedThresholds([{ id: 'context', label: 'ctx', percent: 40, cycle: 's' }], r.ledger, [70, 85])
    expect(r.ledger.context.sent).toEqual([])
    expect(crossedThresholds([{ id: 'context', label: 'ctx', percent: 71, cycle: 's' }], r.ledger, [70, 85]).alerts.length).toBe(1)
  })
  test('missing or invalid readings preserve the ledger', () => {
    const r = crossedThresholds([{ id: '5h', label: '5h', percent: 75, cycle: 'a' }], {}, [70])
    expect(crossedThresholds([], r.ledger, [70]).ledger).toEqual(r.ledger)
    expect(crossedThresholds([{ id: '5h', label: '5h', percent: NaN, cycle: 'a' }], r.ledger, [70]).alerts).toEqual([])
  })
})
describe('task outcomes and effort', () => {
  test('a finished response preserves unfinished steps and percentage', () => {
    const finished = { ...finishTask(task, 'answer'), doneAt: 20 }
    expect(finished.outcome).toBe('waiting')
    expect(percentOf(finished)).toBe(50)
    expect(stepLabel(finished)).toBe('Waiting')
  })
  test('only a complete plan becomes completed', () => {
    const done = finishTask({ ...task, steps: task.steps.map(s => ({ ...s, status: 'completed' })) }, 'answer')
    expect(done.outcome).toBe('completed')
    expect(percentOf(done)).toBe(100)
    expect(finishTask({ ...task, steps: [] }, 'answer').outcome).toBe('waiting')
  })
  test('interruption and error are not successful completion', () => {
    expect(finishTask(task, 'aborted').outcome).toBe('interrupted')
    expect(finishTask(task, 'error').outcome).toBe('failed')
    expect(finishTask(task, 'refusal').outcome).toBe('failed')
    expect(finishTask({ ...task, steps: [{ id: 'f', text: 'Test', status: 'failed' }] }, 'answer').outcome).toBe('failed')
  })
  test('preserves child effort unless explicitly enabled', () => {
    expect(overrideEffort('agent1', 'low', 'high', false)).toBe('low')
    expect(overrideEffort('agent1', 'low', 'high', true)).toBe('high')
    expect(overrideEffort(undefined, 'low', 'high', false)).toBe('high')
    expect(overrideEffort(undefined, undefined, 'high', false)).toBeUndefined()
    expect(overrideEffort('agent1', 1234, 'high', false)).toBe(1234)
  })
})
describe('profiles and notification arguments', () => {
  test('project profile takes priority and a foreign root is ignored', () => {
    expect(resolveProfile(profile, { ...profile, model: 'opus' }, '/project/').scope).toBe('project')
    expect(resolveProfile(profile, { ...profile, model: 'opus' }, '/other').profile?.model).toBe('opus')
    expect(resolveProfile(null, null, '/project').scope).toBe('session')
  })
  test('normalizes Windows paths and validates corrupt profiles', () => {
    expect(normalizeRoot('C:\\Work\\Demo\\')).toBe('c:/work/demo')
    expect(normalizeProfile({ version: 2 })).toBe(null)
    expect(normalizeProfile({ ...profile, effort: 'random' })).toBe(null)
    expect(normalizeNotices({ thresholds: [200], refreshSeconds: 1 }).refreshSeconds).toBe(15)
  })
  test('notification text never becomes executable shell source', () => {
    const dangerous = '"; $(whoami); `touch /tmp/x`; <xml> & test'
    const windows = desktopCommand('windows', 'Title', dangerous)
    expect(windows.argv.join(' ')).not.toContain(dangerous)
    expect(windows.env.DEV_CONTROL_MESSAGE).toBe(dangerous)
    expect(desktopCommand('mac', 'Title', dangerous).argv.at(-1)).toBe(dangerous)
    expect(desktopCommand('linux', 'Title', dangerous).argv.at(-1)).toBe(dangerous)
  })
})

const PANE = { component: 'Pane' as const, requestId: 'dev-control-tools', props: { title: 'dev-control', isFocused: true,
  bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 26 }, view: {} } }
const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } }
const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 20 }, view: {} } }
function world(on: On, sent?: string[], options: { usage?: () => unknown; entries?: Record<string, unknown>; desktopExit?: number } = {}) {
  const clock = mock.clock(on)
  mock.store(on, options.entries)
  mock.env(on, { HOME: '/home/test', OS: 'Linux' })
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  on('ui.open', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => { if (sent) sent.push(e.text); return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/project' }))
  on('session.root', () => ({ value: '/project' }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.usage', () => ({ value: options.usage ? options.usage() : { context: { percent: 10, tokens: 20_000, window: 200_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('config.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_$, e) => { if (sent) sent.push(e.argv[0]); return { value: { exitCode: e.argv[0] === 'notify-send' ? options.desktopExit ?? 0 : 0, stdout: e.argv[0] === 'uname' ? 'Linux' : 'main\n', stderr: '' } } })
  on('session.end', () => ({ sessionId: 'test-session' }))
  on('command.run', () => ({ text: '' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return clock
}
describe('Dev Control integration', () => {
  test('restores the matching project profile on startup', async ($, on) => {
    world(on, undefined, { entries: { 'profile:/project': { ...profile, model: 'claude-sonnet-5-5' }, globalProfile: { ...profile, effort: 'low' } } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/project' })
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-profiles' })
    expect(await menu.find({ text: /Loaded scope: project/ })).toBeDefined()
    await menu.press({ key: 'tools-back' }); await menu.press({ key: 'open-mode' })
    expect((await menu.find({ key: 'effort-high' }))?.text).toMatch(/● high/)
  })
  test('checks usage periodically, warns once and stops polling at session end', async ($, on) => {
    const sent: string[] = []
    let percent = 10; let reads = 0
    const clock = world(on, sent, { usage: () => { reads++; return { context: { percent, tokens: 20000, window: 200000 }, rateLimits: [] } } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/project' })
    percent = 86
    await clock.advance(30000); await clock.settle()
    expect(sent.filter(s => s.startsWith('Usage warning:')).length).toBe(1)
    await clock.advance(30000); await clock.settle()
    expect(sent.filter(s => s.startsWith('Usage warning:')).length).toBe(1)
    await $.session.end({ reason: 'prompt_input_exit' })
    const stopped = reads
    await clock.advance(60000); await clock.settle()
    expect(reads).toBe(stopped)
  })
  test('keeps unavailable readings distinct from zero', async ($, on) => {
    world(on, undefined, { usage: () => ({ context: { percent: null, tokens: null, window: null }, rateLimits: [] }) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/project' })
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-usage' })
    expect(await menu.find({ text: /Context: unavailable/ })).toBeDefined()
    expect(await menu.find({ text: /5h account limit: unavailable/ })).toBeDefined()
  })
  test('native delivery failure preserves the terminal notice', async ($, on) => {
    const sent: string[] = []
    world(on, sent, { desktopExit: 1 })
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-notifications' })
    await menu.press({ key: 'notice-desktop' }); await menu.press({ key: 'notice-test' })
    expect(sent).toContain('Dev Control: Test notification')
    expect(await menu.find({ text: /desktop: unavailable/ })).toBeDefined()
  })
  test('error cooldown does not alter the original tool result', async ($, on) => {
    const sent: string[] = []; const clock = world(on, sent)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'Command failed', isError: true }))
    const first = await $.tool.call({ tool: 'Bash', command: 'test-command' })
    await clock.settle()
    await $.tool.call({ tool: 'Bash', command: 'test-command' }); await clock.settle()
    expect(first.result).toBe('Command failed')
    expect(first.isError).toBe(true)
    expect(sent.filter(s => s.startsWith('Tool issue:')).length).toBe(1)
    await clock.advance(60000)
    await $.tool.call({ tool: 'Bash', command: 'test-command' }); await clock.settle()
    expect(sent.filter(s => s.startsWith('Tool issue:')).length).toBe(2)
  })
  test('opens every new section on terminal and desktop', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const opener = await $.ui.mount({ plugin: 'dev-control', surface, ...HINT })
      const menu = await $.ui.mount({ plugin: 'dev-control', surface, ...PANE })
      await opener.press({ key: 'tools-toggle' })
      for (const panel of ['usage', 'notifications', 'profiles', 'agents']) {
        await menu.press({ key: `open-${panel}` })
        expect(await menu.find({ key: 'tools-back' })).toBeDefined()
        await menu.press({ key: 'tools-back' })
      }
      await opener.press({ key: 'tools-toggle' })
      await opener.unmount(); await menu.unmount()
    }
  })
  test('sends selected terminal, sound and desktop channels', async ($, on) => {
    const sent: string[] = []
    const clock = world(on, sent)
    on('audio.play', (_$, e) => { sent.push(e.clip.asset!); return { value: undefined } })
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-notifications' })
    await menu.press({ key: 'notice-sound' }); await menu.press({ key: 'notice-desktop' })
    await menu.press({ key: 'notice-test' }); await clock.settle()
    expect(sent).toContain('Dev Control: Test notification')
    expect(sent).toContain('assets/notice.wav')
    expect(sent).toContain('notify-send')
  })
  test('handoff preserves the existing draft and submits no prompt', async ($, on) => {
    const clock = world(on)
    let filled = ''; let submitted = false
    on('prompt.read', () => ({ value: { text: 'My draft', cursor: 8 } }))
    on('prompt.fill', (_$, e) => { filled = e.text; return { isFilled: true } })
    on('prompt.submit', () => { submitted = true; return { text: '' } })
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-usage' })
    await menu.press({ key: 'handoff' }); await clock.settle()
    expect(filled).toBe('\n\n' + HANDOFF_PROMPT)
    expect(submitted).toBe(false)
  })
  test('main response and child response never fake plan completion', async ($, on) => {
    world(on)
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    const band = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...BAND })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-zen' }); await menu.press({ key: 'zen-on' })
    await $.tool.call({ tool: 'mcp__dev-control__zen_progress', title: 'Fix', steps: task.steps })
    await $.turn.complete({ answer: 'Child done', durationMs: 10, turnId: 'child', agentId: 'child1', isAborted: false, reason: 'answer' })
    expect(await band.find({ text: /50%/ })).toBeDefined()
    expect(await band.find({ text: 'Waiting' })).toBeUndefined()
    await $.turn.complete({ answer: 'Need more information', durationMs: 20, turnId: 'main', isAborted: false, reason: 'answer' })
    expect(await band.find({ text: /50%/ })).toBeDefined()
    expect(await band.find({ text: /Waiting/ })).toBeDefined()
  })
  test('Zen keeps failed commands visible and expands ordinary details', async ($, on) => {
    world(on)
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-zen' }); await menu.press({ key: 'zen-on' })
    const props = { tool_use_id: 'x', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: { exitCode: 1 } }
    const failed = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', component: 'ToolUse', props })
    expect(await failed.find({ text: 'engine' })).toBeDefined()
    const ordinary = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', component: 'ToolUse', props: { ...props, output: { exitCode: 0 } } })
    expect(await ordinary.find({ text: 'engine' })).toBeUndefined()
    await menu.press({ key: 'zen-details' })
    expect(await ordinary.find({ text: 'engine' })).toBeDefined()
  })
  test('lists real agents and shows observed outcomes', async ($, on) => {
    const clock = world(on)
    on('agent.list', () => ({ value: [{ id: 'child1', type: 'Explore', description: 'Inspect files', status: 'completed' }] }))
    await $.turn.complete({ answer: 'Found the cause', durationMs: 10, turnId: 'c', agentId: 'child1', isAborted: false, reason: 'answer' })
    const opener = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...HINT })
    const menu = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...PANE })
    await opener.press({ key: 'tools-toggle' }); await menu.press({ key: 'open-agents' })
    await menu.press({ key: 'agents-refresh' }); await clock.settle()
    await menu.press({ key: 'agent-select-child1' })
    expect(await menu.find({ text: /Found the cause/ })).toBeDefined()
    expect(await menu.find({ text: /Inspect files/ })).toBeDefined()
  })
})
