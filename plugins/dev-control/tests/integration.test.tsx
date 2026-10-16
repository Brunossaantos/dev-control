import { test, describe, expect, mock } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'
import { defaults, CONTINUITY } from '../hooks/domain'

const panel = { component: 'Pane' as const, requestId: 'dc-dashboard', props: { title: 'Dev Control', isFocused: true, bodyColumns: 62, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } }
const hint = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: 'Help' } }
const progress = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} } }
function setup(on: On, options: { entries?: Record<string, unknown>; usage?: () => SessionUsage; env?: Record<string, string>; files?: Map<string, string>; failDesktop?: boolean } = {}) {
  const timer = mock.clock(on); mock.store(on, options.entries)
  mock.env(on, { HOME: '/users/test', OS: 'Linux', ...options.env })
  const messages: string[] = [], processCalls: { argv: readonly string[]; env?: Record<string, string> }[] = [], played: string[] = []
  const files = options.files ?? new Map<string, string>()
  let readingCount = 0, model = 'claude-sonnet-5-5'
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'native renderer' }))
  on('ui.open', () => ({ value: undefined })); on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => { messages.push(e.text); return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd })); on('session.end', () => ({ sessionId: 'dc-test' }))
  on('session.root', () => ({ value: '/demo' })); on('session.cwd', () => ({ value: '/demo' }))
  on('session.id', () => ({ value: 'dc-test' })); on('session.model', () => ({ value: model }))
  on('session.usage', () => { readingCount++; return { value: options.usage ? options.usage() : { context: { percent: 12, tokens: 24000, window: 200000 }, rateLimits: [] } } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', (_$, e) => { if (e.command === 'model') model = `claude-${e.args}-5-5`; return { text: 'ok' } })
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '{}' }))
  on('fs.write', (_$, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('audio.play', (_$, e) => { played.push(e.clip.asset!); return { value: undefined } })
  on('process.run', (_$, e) => { processCalls.push({ argv: e.argv, env: e.init?.env }); return { value: { exitCode: options.failDesktop && ['notify-send', 'powershell.exe', 'osascript'].includes(e.argv[0]) ? 1 : 0,
    stdout: e.argv[0] === 'uname' ? 'Linux' : 'development\n', stderr: '' } } })
  return { timer, messages, files, processCalls, played, reads: () => readingCount }
}
describe('interações do painel', () => {
  test('tarefas nativas atualizam progresso após sucesso no agente principal', async ($, on) => {
    setup(on)
    on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    const band = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...progress })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-focus' }); await body.press({ key: 'focus-toggle' })
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Read', activeForm: 'Reading', status: 'completed' }, { content: 'Check', activeForm: 'Checking', status: 'pending' }] })
    expect(await band.find({ text: /50%/ })).toBeDefined()
    await $.tool.call({ tool: 'TodoWrite', agentId: 'child', todos: [{ content: 'Child task', activeForm: 'Working', status: 'completed' }] })
    expect(await band.find({ text: /50%/ })).toBeDefined()
  })
  test('painéis funcionam no terminal e desktop com autoria de Bruno', async ($, on) => {
    setup(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const control = await $.ui.mount({ plugin: 'dev-control', surface, ...hint })
      const body = await $.ui.mount({ plugin: 'dev-control', surface, ...panel })
      await control.press({ key: 'dashboard-open' })
      expect(await body.find({ text: /Bruno/ })).toBeDefined()
      for (const page of ['usage', 'notices', 'focus', 'appearance', 'model', 'profiles', 'agents']) {
        await body.press({ key: `nav-${page}` }); expect(await body.find({ key: 'back' })).toBeDefined(); await body.press({ key: 'back' })
      }
      await body.press({ key: 'close' }); await control.unmount(); await body.unmount()
    }
  })
  test('som e avisos do sistema são selecionados separadamente', async ($, on) => {
    const f = setup(on)
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-notices' })
    await body.press({ key: 'channel-audio' }); await body.press({ key: 'channel-desktop' }); await body.press({ key: 'notice-test' })
    expect(f.messages).toContain('Dev Control: Teste de notificação')
    expect(f.played).toEqual(['assets/alert.wav'])
    expect(f.processCalls.some(c => c.argv[0] === 'notify-send')).toBe(true)
  })
  test('falha do sistema não cancela aviso no terminal', async ($, on) => {
    const f = setup(on, { failDesktop: true })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-notices' })
    await body.press({ key: 'channel-desktop' }); await body.press({ key: 'notice-test' })
    expect(f.messages).toContain('Dev Control: Teste de notificação')
    expect(await body.find({ text: /notificação do sistema indisponível/ })).toBeDefined()
  })
  test('continuidade preserva rascunho sem enviá-lo', async ($, on) => {
    setup(on); let changed = '', sent = false
    on('prompt.read', () => ({ value: { text: 'Existing draft', cursor: 14 } }))
    on('prompt.fill', (_$, e) => { changed = e.text; return { isFilled: true } })
    on('prompt.submit', () => { sent = true; return { text: '' } })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-usage' }); await body.press({ key: 'handoff' })
    expect(changed).toBe('\n\n' + CONTINUITY); expect(sent).toBe(false)
  })
  test('planos incompletos mantêm percentual após término dos agentes', async ($, on) => {
    setup(on)
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    const band = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...progress })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-focus' }); await body.press({ key: 'focus-toggle' })
    await $.tool.call({ tool: 'mcp__dev-control__progress_report', title: 'Work', steps: [{ title: 'Read', state: 'done' }, { title: 'Test', state: 'pending' }] })
    await $.turn.complete({ turnId: 'child-turn', agentId: 'worker1', answer: 'Worker result', reason: 'answer', durationMs: 1, isAborted: false })
    expect(await band.find({ text: /Em andamento · 50%/ })).toBeDefined()
    await $.turn.complete({ turnId: 'main-turn', answer: 'Need input', reason: 'answer', durationMs: 10, isAborted: false })
    expect(await band.find({ text: /Aguardando · 50%/ })).toBeDefined()
  })
  test('foco preserva a saída de comandos com falha', async ($, on) => {
    setup(on)
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-focus' }); await body.press({ key: 'focus-toggle' })
    const input = { tool_use_id: 'bash1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: { exitCode: 1 } }
    const failed = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', component: 'ToolUse', props: input })
    expect(await failed.find({ text: 'native renderer' })).toBeDefined()
    const normal = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', component: 'ToolUse', props: { ...input, output: { exitCode: 0 } } })
    expect(await normal.find({ text: 'native renderer' })).toBeUndefined()
    await body.press({ key: 'details-toggle' })
    expect(await normal.find({ text: 'native renderer' })).toBeDefined()
  })
  test('agentes e resultados vêm de eventos observados', async ($, on) => {
    setup(on)
    on('agent.list', () => ({ value: [{ id: 'worker1', type: 'Explore', status: 'completed', description: 'Inspect files' }] }))
    await $.turn.complete({ turnId: 'child-turn', agentId: 'worker1', answer: 'Found the relevant file', reason: 'answer', durationMs: 1, isAborted: false })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-agents' }); await body.press({ key: 'worker-worker1' })
    expect(await body.find({ text: /Found the relevant file/ })).toBeDefined()
    expect(await body.find({ text: /Inspect files/ })).toBeDefined()
  })
})
describe('persistência e notificações', () => {
  test('esforço de subagentes é preservado até alteração explícita', async ($, on) => {
    const f = setup(on); const efforts: unknown[] = []
    on('turn.step', async function* (_$, e) { efforts.push(e.effort); return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-model' }); await body.press({ key: 'effort-high' })
    await $.turn.step({ turnId: 'main', index: 0, model: 'sonnet', effort: 'low', messageCount: 0 }).next()
    await $.turn.step({ turnId: 'worker', agentId: 'worker1', index: 0, model: 'haiku', effort: 'low', messageCount: 0 }).next()
    await body.press({ key: 'workers-effort' })
    await $.turn.step({ turnId: 'worker', agentId: 'worker1', index: 1, model: 'haiku', effort: 'low', messageCount: 0 }).next()
    await f.timer.settle()
    expect(efforts).toEqual(['high', 'low', 'high'])
  })
  test('perfil de projeto prevalece sobre global no início', async ($, on) => {
    const global = defaults(), local = defaults(); global.effort = 'low'; local.effort = 'high'
    setup(on, { entries: { 'v2.global': { version: 2, preferences: global }, 'v2.project./demo': { version: 2, root: '/demo', preferences: local } } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/demo' })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-model' })
    expect((await body.find({ key: 'effort-high' }))?.text).toContain('● Alto')
  })
  test('alertas não se repetem e temporizadores encerram com a sessão', async ($, on) => {
    let percent = 12
    const f = setup(on, { usage: () => ({ context: { percent, tokens: 24000, window: 200000 }, rateLimits: [] }) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/demo' }); percent = 90
    await f.timer.advance(30000); await f.timer.settle()
    expect(f.messages.filter(x => x.includes('Contexto: 90%')).length).toBe(1)
    await f.timer.advance(30000); await f.timer.settle()
    expect(f.messages.filter(x => x.includes('Contexto: 90%')).length).toBe(1)
    await $.session.end({ reason: 'prompt_input_exit' }); const count = f.reads()
    await f.timer.advance(60000); await f.timer.settle(); expect(f.reads()).toBe(count)
  })
  test('contexto e limites ausentes aparecem como indisponíveis', async ($, on) => {
    setup(on, { usage: () => ({ context: { percent: null, tokens: null, window: null }, rateLimits: [] }) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/demo' })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-usage' })
    expect(await body.find({ text: 'Contexto: indisponível' })).toBeDefined()
    expect(await body.find({ text: 'Limite de 5h: indisponível' })).toBeDefined()
  })
  test('avisos respeitam intervalo sem alterar resultados de ferramentas', async ($, on) => {
    const f = setup(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'error text', isError: true }))
    const first = await $.tool.call({ tool: 'Bash', command: 'test' }); await f.timer.settle()
    await $.tool.call({ tool: 'Bash', command: 'test' }); await f.timer.settle()
    expect(first.result).toBe('error text'); expect(first.isError).toBe(true)
    expect(f.messages.filter(x => x.includes('Ferramenta Bash')).length).toBe(1)
    await f.timer.advance(60000); await $.tool.call({ tool: 'Bash', command: 'test' }); await f.timer.settle()
    expect(f.messages.filter(x => x.includes('Ferramenta Bash')).length).toBe(2)
  })
  test('cores do Windows Terminal são restauradas sem perder preferências', async ($, on) => {
    const path = '/test/local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'
    const existing = { profiles: { list: [{ guid: '{TEST}', name: 'PowerShell', colorScheme: 'Campbell' }] }, schemes: [{ name: 'Personal' }], customSetting: 123 }
    const f = setup(on, { env: { OS: 'Windows_NT', USERPROFILE: '/users/test', LOCALAPPDATA: '/test/local', WT_PROFILE_ID: '{TEST}' }, files: new Map([[path, JSON.stringify(existing)]]) })
    const control = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...hint })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await control.press({ key: 'dashboard-open' }); await body.press({ key: 'nav-appearance' }); await body.press({ key: 'palette-ocean' })
    expect(JSON.parse(f.files.get(path)!).profiles.list[0].colorScheme).toContain('Dev Control')
    expect(f.files.has(path + '.dev-control.bak')).toBe(true)
    await body.press({ key: 'palette-restore' })
    const restored = JSON.parse(f.files.get(path)!)
    expect(restored.profiles.list[0].colorScheme).toBe('Campbell'); expect(restored.customSetting).toBe(123)
    expect(restored.schemes).toEqual([{ name: 'Personal' }])
  })
})

 describe('interface em português', () => {
  test('atalhos em português abrem as seções corretas, inclusive com acento', async ($, on) => {
    setup(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/demo' })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    for (const [args, title] of [['consumo', 'Consumo'], ['notificações', 'Notificações'], ['zen', 'Foco'], ['temas', 'Temas'], ['modelo', 'Modelo'], ['perfis', 'Perfis'], ['agentes', 'Agentes']]) {
      await $.command.run({ command: 'dev-control', args })
      expect(await body.find({ text: `Dev Control · ${title}` })).toBeDefined()
    }
  })
  test('permissões e perfis traduzem a apresentação e preservam os valores nativos', async ($, on) => {
    const f = setup(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/demo' })
    const body = await $.ui.mount({ plugin: 'dev-control', surface: 'terminal', ...panel })
    await $.command.run({ command: 'dev-control', args: 'modelo' })
    expect((await body.find({ key: 'permission-acceptEdits' }))?.text).toBe('Aceitar edições')
    await body.press({ key: 'permission-acceptEdits' })
    expect(JSON.parse(f.files.get('/users/test/.claude/settings.json')!).permissions.defaultMode).toBe('acceptEdits')
    await $.command.run({ command: 'dev-control', args: 'perfis' })
    await body.press({ key: 'save-project' })
    expect(await body.find({ text: 'Perfil carregado: projeto' })).toBeDefined()
    expect(f.messages).toContain('Preferências salvas: projeto.')
  })
})
