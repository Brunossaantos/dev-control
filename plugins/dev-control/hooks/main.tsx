import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface, RenderInput, RenderChildren, Timer } from 'claude-code'
import type { Screen, Preferences, Dashboard, Usage, Worker, Plan, SavedPreferences, AlertMemory, Palette, WindowsRestore } from '../types'
import { blank, defaults, preferences, projectKey, bands, alerts, percentage, endPlan, steps, failure, numberLabel, remaining, PALETTES, shade, jsonc, hex, label, meter, CONTINUITY } from './domain'

const state = atom({ plugin: 'dev-control', key: 'dashboard' } as const, blank())
const PANEL = 'dc-dashboard'
let refreshTimer: Timer | undefined
let displayTimer: Timer | undefined
type Host = EngineInterface

async function clock($: Host) { return $.clock.now() }
async function home($: Host) {
  const p = await $.env.get('USERPROFILE') || await $.env.get('HOME')
  if (!p) throw new Error('Pasta pessoal do usuário indisponível')
  return p.replaceAll('\\', '/')
}
async function patchPreferences($: Host, patch: Partial<Preferences>) {
  await update($, state, s => ({ ...s, prefs: { ...s.prefs, ...patch } }))
}
async function root($: Host) {
  try { return projectKey(await $.session.root()) } catch { return projectKey(await $.session.cwd()) }
}
async function changeModel($: Host, model: string) {
  await $.command.run({ command: 'model', args: model })
  await patchPreferences($, { model })
  await measure($)
}
async function restorePreferences($: Host) {
  const currentRoot = await root($)
  const local = await $.store.get(`v2.project.${currentRoot}`) as SavedPreferences | undefined
  const general = await $.store.get('v2.global') as SavedPreferences | undefined
  const validLocal = local?.version === 2 && local.root === currentRoot
  const selected = validLocal ? local : general?.version === 2 ? general : undefined
  const cfg = preferences(selected?.preferences)
  await update($, state, s => ({ ...s, prefs: cfg, root: currentRoot, profile: selected ? validLocal ? 'project' : 'global' : 'session' }))
  if (cfg.model && cfg.model !== await $.session.model()) await changeModel($, cfg.model)
  if (cfg.palette) await applyAppearance($, cfg.palette)
}
async function savePreferences($: Host, scope: 'project' | 'global') {
  const s = await read($, state)
  const saved: SavedPreferences = { version: 2, preferences: preferences(s.prefs), ...(scope === 'project' ? { root: s.root } : {}) }
  await $.store.set(scope === 'project' ? `v2.project.${s.root}` : 'v2.global', saved)
  await update($, state, x => ({ ...x, profile: scope }))
  $.ui.toast(`Preferências salvas: ${label(scope)}.`)
}
async function forgetPreferences($: Host, scope: 'project' | 'global') {
  await $.store.delete(scope === 'project' ? `v2.project.${(await read($, state)).root}` : 'v2.global')
  $.ui.toast(`Preferências removidas: ${label(scope)}. Sessão atual preservada.`)
}
async function open($: Host, screen: Screen = 'home') {
  const s = await read($, state)
  if (s.screen !== null) await $.ui.close({ id: PANEL })
  await update($, state, x => ({ ...x, screen }))
  if (screen === 'agents') await collectWorkers($)
  await $.ui.open({ id: PANEL, title: 'Dev Control · Bruno', rows: 30, columns: 62, closeOnEscape: true, focus: true })
}
async function visit($: Host, screen: Screen) {
  await update($, state, s => ({ ...s, screen }))
  if (screen === 'agents') await collectWorkers($)
}
async function close($: Host) {
  await $.ui.close({ id: PANEL })
  await update($, state, s => ({ ...s, screen: null }))
}

// O texto dos avisos segue em argumentos ou variáveis de ambiente, sem ser executado pelo shell.
async function desktop($: Host, text: string) {
  const win = await $.env.get('OS') === 'Windows_NT' || !!await $.env.get('WSL_DISTRO_NAME')
  if (win) {
    const script = `Add-Type -AssemblyName System.Windows.Forms
$n = [System.Windows.Forms.NotifyIcon]::new()
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
try { $n.ShowBalloonTip(2500, 'Dev Control', $env:DC_NOTICE_TEXT, [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 3 }
finally { $n.Visible = $false; $n.Dispose() }`
    return $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], { env: { DC_NOTICE_TEXT: text }, timeoutMs: 5000 })
  }
  const os = await $.process.run(['uname', '-s'], { timeoutMs: 2000 })
  if (os.stdout.trim() === 'Darwin') return $.process.run(['osascript', '-e', 'on run parameters\n display notification (item 1 of parameters) with title "Dev Control"\nend run', text], { timeoutMs: 5000 })
  return $.process.run(['notify-send', '--app-name=Dev Control', '--', 'Dev Control', text], { timeoutMs: 5000 })
}
async function notice($: Host, kind: 'usage' | 'response' | 'failures' | 'input', text: string, test = false) {
  try {
    const s = await read($, state); const cfg = s.prefs
    if (!test && kind !== 'usage' && !cfg.events[kind]) return
    const key = `v2.notice.${await $.session.id()}.${kind}`
    const previous = await $.store.get(key); const time = await clock($)
    if (!test && kind !== 'usage' && typeof previous === 'number' && time - previous < cfg.cooldown * 1000) return
    if (!Object.values(cfg.channels).some(Boolean)) { await update($, state, x => ({ ...x, delivery: 'Todos os canais desativados' })); return }
    await $.store.set(key, time)
    const jobs: Promise<string>[] = []
    if (cfg.channels.terminal) {
      $.ui.toast(`Dev Control: ${text}`, { timeoutMs: 8000 })
      jobs.push(Promise.resolve('aviso enviado ao terminal'))
    }
    if (cfg.channels.audio) jobs.push((async () => { try { await $.audio.play({ asset: 'assets/alert.wav' }); return 'som reproduzido' } catch { return 'som indisponível' } })())
    if (cfg.channels.desktop) jobs.push((async () => { try { const r = await desktop($, text); return r.exitCode === 0 ? 'comando de notificação aceito' : 'notificação do sistema indisponível' } catch { return 'notificação do sistema indisponível' } })())
    const messages = await Promise.all(jobs)
    await update($, state, x => ({ ...x, delivery: messages.join(' · ') }))
  } catch { /* Falhas de notificação preservam a sessão. */ }
}
async function measure($: Host) {
  const token = `${Date.now()}-${Math.random()}`
  const reserved = await update($, state, s => s.busy ? s : { ...s, busy: token })
  if (reserved.busy !== token) return
  try {
    const [data, model, directory, time] = await Promise.all([$.session.usage(), $.session.model(), $.session.cwd(), clock($)])
    let branch = ''
    try { const git = await $.process.run(['git', '-C', directory, 'branch', '--show-current'], { timeoutMs: 2000 }); if (!git.exitCode) branch = git.stdout.trim() } catch {}
    const context = data.context.percent
    const reading: Usage = { checked: time, model, directory, branch, tokens: data.context.tokens ?? null, window: data.context.window ?? null,
      readings: [{ key: 'context', value: typeof context === 'number' && Number.isFinite(context) ? context : null, reset: await $.session.id() },
        ...data.rateLimits.filter(r => r.kind === 'five_hour' || r.kind === 'seven_day').map(r => ({ key: r.kind === 'five_hour' ? '5h' : '7d', value: Number.isFinite(r.percentUsed) ? r.percentUsed : null, reset: r.resetsAt ?? null }))] }
    await update($, state, s => ({ ...s, usage: reading, error: '' }))
    const cfg = (await read($, state)).prefs
    if (Object.values(cfg.channels).some(Boolean)) {
      const key = `v2.bands.${await $.session.id()}`
      const raw = await $.store.get(key)
      const prior: AlertMemory = raw && typeof raw === 'object' ? raw as AlertMemory : {}
      const relevant = reading.readings.filter(r => r.key === 'context' ? cfg.events.context : cfg.events.account)
      const crossed = alerts(relevant, prior, cfg.levels)
      await $.store.set(key, crossed.memory)
      if (crossed.messages.length) await notice($, 'usage', crossed.messages.join(' · '))
    }
  } catch { await update($, state, s => ({ ...s, error: 'Leitura indisponível; os valores anteriores podem estar desatualizados.' })) }
  finally { await update($, state, s => s.busy === token ? { ...s, busy: null } : s) }
}
async function collectWorkers($: Host) {
  try {
    const actual = await $.agent.list()
    await update($, state, s => ({ ...s, workerError: '', workers: actual.map(w => ({ ...s.workers.find(v => v.id === w.id), ...w })) }))
  } catch { await update($, state, s => ({ ...s, workerError: 'API de agentes indisponível. Os registros anteriores podem estar desatualizados.' })) }
}
async function observe($: Host, id: string, changes: Partial<Worker>) {
  await update($, state, s => {
    const worker = s.workers.find(w => w.id === id)
    return { ...s, workers: [...s.workers.filter(w => w.id !== id), { id, type: 'agent', description: '', status: 'unknown', ...worker, ...changes }].slice(-100) }
  })
}
async function continuity($: Host) {
  const draft = await $.prompt.read()
  if (draft.text.includes(CONTINUITY)) { $.ui.toast('A solicitação de continuidade já está no rascunho'); return }
  const result = await $.prompt.fill({ text: `${draft.text ? '\n\n' : ''}${CONTINUITY}`, mode: 'append' })
  $.ui.toast(result.isFilled ? 'Solicitação de continuidade preparada. Pressione Enter para enviar.' : 'Nenhuma caixa de mensagem editável disponível.')
}

async function readJson($: Host, path: string): Promise<Record<string, unknown>> {
  if (!await $.fs.exists(path)) return {}
  const parsed = jsonc(await $.fs.read(path))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Era esperado um objeto JSON')
  return parsed as Record<string, unknown>
}
async function writeJson($: Host, path: string, data: unknown) {
  await $.fs.write(path, JSON.stringify(data, null, 2) + '\n')
}
async function windowsAppearance($: Host, palette: Palette | null) {
  const remembered = (await read($, state)).windows
  if (palette === null && !remembered) return
  if (await $.env.get('OS') !== 'Windows_NT') return
  const local = (await $.env.get('LOCALAPPDATA'))?.replaceAll('\\', '/')
  const profile = remembered?.profile ?? await $.env.get('WT_PROFILE_ID')
  if (!local || !profile) return
  const paths = remembered ? [remembered.path] : [
    `${local}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Microsoft/Windows Terminal/settings.json`,
  ]
  let path = ''
  for (const p of paths) if (await $.fs.exists(p)) { const t = await $.fs.read(p); if (t.toLowerCase().includes(profile.toLowerCase())) { path = p; break } }
  if (!path) return
  const settings = await readJson($, path)
  const group = settings.profiles as { list?: Record<string, unknown>[] } | Record<string, unknown>[] | undefined
  const list = Array.isArray(group) ? group : group?.list ?? []
  const target = list.find(p => String(p.guid).toLowerCase() === profile.toLowerCase())
  if (!target) return
  const owner = remembered?.scheme ?? `Dev Control ${await $.session.id()}`
  if (typeof target.colorScheme === 'string' && target.colorScheme.startsWith('Dev Control ') && target.colorScheme !== owner) {
    $.ui.toast('Outra sessão já controla as cores deste perfil do Windows Terminal.'); return
  }
  const schemes = Array.isArray(settings.schemes) ? settings.schemes as Record<string, unknown>[] : []
  if (palette) {
    const snapshot: WindowsRestore = remembered ?? { path, profile, scheme: owner, original: target.colorScheme ?? null }
    if (!remembered) { await $.fs.write(`${path}.dev-control.bak`, await $.fs.read(path)); await update($, state, s => ({ ...s, windows: snapshot })) }
    target.colorScheme = owner
    const normal = ['#64748B', '#EF4444', '#22C55E', '#EAB308', '#3B82F6', '#A855F7', '#06B6D4', palette.foreground]
    const keys = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white']
    const scheme: Record<string, unknown> = { name: owner, background: palette.background, foreground: palette.foreground, cursorColor: palette.accent, selectionBackground: palette.accent }
    keys.forEach((k, i) => { scheme[k] = normal[i]; scheme[`bright${k[0].toUpperCase()}${k.slice(1)}`] = normal[i] })
    settings.schemes = [...schemes.filter(s => s.name !== owner), scheme]
  } else if (remembered) {
    if (target.colorScheme === owner) { if (remembered.original === null) delete target.colorScheme; else target.colorScheme = remembered.original }
    if (!list.some(p => p.colorScheme === owner)) settings.schemes = schemes.filter(s => s.name !== owner)
    await update($, state, s => ({ ...s, windows: null }))
  }
  await writeJson($, path, settings)
}
async function applyAppearance($: Host, id: string | null) {
  const folder = `${await home($)}/.claude`
  const path = `${folder}/settings.json`
  const settings = await readJson($, path)
  if (id === null) {
    const original = await $.store.get('v2.original-theme') as { present: boolean; value?: unknown } | undefined
    if (original) { if (original.present) settings.theme = original.value; else delete settings.theme; await writeJson($, path, settings); await $.store.delete('v2.original-theme') }
    await windowsAppearance($, null)
    await patchPreferences($, { palette: null })
    return
  }
  const cfg = (await read($, state)).prefs
  const palette = id === 'custom' ? { id, label: 'Personalizado', accent: cfg.accent, background: cfg.background, foreground: cfg.foreground } : PALETTES.find(p => p.id === id)
  if (!palette) throw new Error('Paleta desconhecida')
  if (!await $.store.get('v2.original-theme')) {
    await $.store.set('v2.original-theme', { present: Object.hasOwn(settings, 'theme'), value: settings.theme ?? null })
    await $.fs.write(`${path}.dev-control.bak`, await $.fs.exists(path) ? await $.fs.read(path) : '{}')
  }
  await writeJson($, `${folder}/themes/dev-control.json`, shade(palette))
  const first = settings.theme !== 'custom:dev-control'
  settings.theme = 'custom:dev-control'
  await writeJson($, path, settings)
  await patchPreferences($, { palette: id })
  await windowsAppearance($, palette)
  $.ui.toast(first ? 'Reinicie o Claude Code uma vez para carregar o tema personalizado. As próximas alterações serão aplicadas ao vivo.' : `Tema: ${palette.label}`)
}
async function setDefaultPermission($: Host, value: string) {
  const path = `${await home($)}/.claude/settings.json`; const cfg = await readJson($, path)
  if (!await $.fs.exists(`${path}.dev-control-permissions.bak`)) await $.fs.write(`${path}.dev-control-permissions.bak`, await $.fs.exists(path) ? await $.fs.read(path) : '{}')
  const before = cfg.permissions && typeof cfg.permissions === 'object' ? cfg.permissions as Record<string, unknown> : {}
  cfg.permissions = { ...before, defaultMode: value }
  await writeJson($, path, cfg)
  $.ui.toast('Permissão padrão salva para sessões futuras. As verificações nativas continuam ativas.')
}

async function drawPanel($: Host, e: RenderInput<'Pane'>) {
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return null
  const s = await read($, state); if (s.screen === null) return null
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const cfg = s.prefs; const time = await clock($)
  const action = (f: () => Promise<unknown>) => () => f().catch(error => $.ui.toast(`Dev Control: ${String(error)}`))
  const button = (key: string, title: string, f: () => Promise<unknown>) => <Button key={key} plain label={title} onPress={action(f)} />
  const hint = (key: string, text: string) => <Text key={key} dimColor>{text}</Text>
  const section = (text: string) => <Text key={`section-${text}`} bold>{text}</Text>
  const switchChannel = (key: keyof Preferences['channels'], label: string) => button(`channel-${key}`, `${cfg.channels[key] ? '●' : '○'} ${label}`, () => patchPreferences($, { channels: { ...cfg.channels, [key]: !cfg.channels[key] } }))
  const switchEvent = (key: keyof Preferences['events'], label: string) => button(`event-${key}`, `${cfg.events[key] ? '●' : '○'} ${label}`, () => patchPreferences($, { events: { ...cfg.events, [key]: !cfg.events[key] } }))
  let rows: RenderChildren[] = []
  if (s.screen === 'home') rows = [
    hint('intro', 'Consumo, foco e notificações para qualquer projeto.'),
    ...([['usage', 'Monitor de consumo'], ['notices', 'Notificações'], ['focus', 'Zen / foco'], ['appearance', 'Temas'], ['model', 'Modelo e permissões'], ['profiles', 'Perfis de projeto'], ['agents', 'Monitor de agentes']] as const)
      .map(([page, title]) => button(`nav-${page}`, `${title}  →`, () => visit($, page))),
    hint('author', 'Dev Control 0.2.3 · Bruno · github.com/Brunossaantos'),
  ]
  if (s.screen === 'usage') rows = [
    hint('usage-info', 'Contexto é o tamanho da conversa; os limites da conta vêm da última resposta da API.'),
    ...['context', '5h', '7d'].map(key => { const r = s.usage?.readings.find(v => v.key === key); return <Text key={`metric-${key}`}>{label(key)}: {r?.value == null ? 'indisponível' : meter(r.value)}{key !== 'context' && r ? ` · renova em ${remaining(r.reset, time)}` : ''}</Text> }),
    hint('tokens', `Tokens: ${numberLabel(s.usage?.tokens ?? null)} / ${numberLabel(s.usage?.window ?? null)}`),
    hint('checked', s.usage ? `Leitura verificada há ${Math.max(0, Math.floor((time - s.usage.checked) / 1000))}s` : 'Nenhuma leitura disponível'),
    hint('cache-age', s.lastReply === null ? 'Idade do cache: não observada' : `Idade estimada do cache: ${Math.floor(Math.max(0, time - s.lastReply) / 60000)}m · ${time - s.lastReply < 3600000 ? '~recente' : '~mais de uma hora'}. Isso não comprova reutilização do cache.`),
    s.error && <Text key="error" color="warning">{s.error}</Text>,
    button('refresh', s.busy ? 'Consultando…' : 'Consultar consumo agora', () => measure($)),
    button('handoff', 'Preparar solicitação de continuidade', () => continuity($)),
    hint('handoff-note', 'Preserva o rascunho atual; pressione Enter quando quiser enviar.'),
  ]
  if (s.screen === 'notices') rows = [section('Canais'), switchChannel('terminal', 'Terminal'), switchChannel('audio', 'Som'), switchChannel('desktop', 'Sistema operacional'),
    section('Eventos'), switchEvent('context', 'Faixas de contexto'), switchEvent('account', 'Faixas da conta'), switchEvent('response', 'Resposta principal concluída'), switchEvent('failures', 'Erros'), switchEvent('input', 'Aguardando sua resposta'),
    <Input key="levels" label="Faixas (%)" value={cfg.levels.join(', ')} submitLabel="salvar" onSubmit={value => { const result = bands(value); return result ? patchPreferences($, { levels: result }) : $.ui.toast('Use de 1 a 6 números inteiros entre 1 e 100') }} />,
    ...(['interval', 'cooldown'] as const).map(key => <Input key={key} label={key === 'interval' ? 'Intervalo mínimo de consulta (15–300 s)' : 'Pausa entre avisos do mesmo evento (5–600 s)'} value={String(cfg[key])} submitLabel="salvar"
      onSubmit={value => { const n = Number(value), min = key === 'interval' ? 15 : 5, max = key === 'interval' ? 300 : 600; return Number.isInteger(n) && n >= min && n <= max ? patchPreferences($, { [key]: n }) : $.ui.toast(`Informe um número entre ${min} e ${max}`) }} />),
    button('notice-test', 'Testar os canais de notificação selecionados', () => notice($, 'usage', 'Teste de notificação', true)), hint('delivery', s.delivery || 'Sistema operacional display depends on your OS settings.'),
  ]
  if (s.screen === 'focus') rows = [
    button('focus-toggle', `${cfg.focus ? '●' : '○'} Zen / foco`, () => patchPreferences($, { focus: !cfg.focus })),
    button('details-toggle', cfg.details ? 'Recolher detalhes das ferramentas' : 'Mostrar todos os detalhes das ferramentas', () => patchPreferences($, { details: !cfg.details })),
    hint('focus-info', 'Falhas continuam visíveis. O fim da resposta não conclui etapas pendentes.'),
    hint('focus-state', s.plan ? `${s.plan.title} · ${label(s.plan.state)}` : 'Nenhum progresso informado'),
    ...s.plan?.steps.map((step, i) => <Text key={`focus-step-${i}`}>{label(step.state)}: {step.title}</Text>) ?? [],
  ]
  if (s.screen === 'appearance') rows = [
    hint('theme-info', 'Paletas próprias do Dev Control. Selecione para aplicar; o primeiro tema personalizado exige reiniciar.'),
    ...PALETTES.map(p => button(`palette-${p.id}`, `${cfg.palette === p.id ? '●' : '○'} ${p.label}`, () => applyAppearance($, p.id))),
    ...(['accent', 'background', 'foreground'] as const).map(key => <Input key={`color-${key}`} label={`${label(key)} personalizada`} value={cfg[key]} submitLabel="salvar" onSubmit={value => hex(value) ? patchPreferences($, { [key]: value }) : $.ui.toast('Use uma cor hexadecimal de seis dígitos, como #38BDF8')} />),
    button('palette-custom', 'Aplicar paleta personalizada', () => applyAppearance($, 'custom')),
    button('palette-restore', 'Restaurar tema anterior', () => applyAppearance($, null)),
    hint('theme-windows', 'Abas do mesmo perfil do Windows Terminal compartilham cores. O perfil é restaurado ao encerrar a sessão.'),
  ]
  if (s.screen === 'model') rows = [section('Modelo'),
    ...['default', 'opus', 'sonnet', 'haiku', 'fable'].map(m => button(`model-${m}`, label(m), () => changeModel($, m))),
    section('Esforço'), ...(['low', 'medium', 'high', 'xhigh', 'max'] as const).map(level => button(`effort-${level}`, `${cfg.effort === level ? '●' : '○'} ${label(level)}`, () => patchPreferences($, { effort: level }))),
    button('effort-native', 'Usar esforço nativo', () => patchPreferences($, { effort: null })),
    button('workers-effort', `${cfg.workerEffort ? '●' : '○'} Aplicar esforço também aos subagentes`, () => patchPreferences($, { workerEffort: !cfg.workerEffort })),
    hint('permission-now', `Permissão atual: ${s.permission ? label(s.permission) : 'não observado'} · Shift+Tab altera a permissão`),
    section('Padrão para sessões futuras'),
    ...['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions'].map(mode => button(`permission-${mode}`, label(mode), () => setDefaultPermission($, mode))),
    hint('permission-note', 'São configurações nativas de permissão. As confirmações exigidas pelo Claude Code são preservadas.'),
  ]
  if (s.screen === 'profiles') rows = [hint('profile-root', `Projeto: ${s.root || 'não inicializado'}`), hint('profile-scope', `Perfil carregado: ${label(s.profile)}`),
    button('save-project', 'Salvar preferências deste projeto', () => savePreferences($, 'project')),
    button('save-global', 'Salvar como preferências globais', () => savePreferences($, 'global')),
    button('forget-project', 'Remover preferências do projeto', () => forgetPreferences($, 'project')),
    button('forget-global', 'Remover preferências globais', () => forgetPreferences($, 'global')),
    hint('profile-info', 'As preferências do projeto prevalecem sobre as globais. Nenhum arquivo do projeto é alterado. Permissões nativas não são salvas aqui.'),
  ]
  if (s.screen === 'agents') {
    const visible = s.workers.filter(w => `${w.id} ${w.name ?? ''} ${w.type} ${w.description} ${label(w.status)}`.toLowerCase().includes(s.filter.toLowerCase()))
    const selected = s.workers.find(w => w.id === s.selected)
    rows = [hint('agents-info', 'Apenas registros observados no motor. Este painel não inicia agentes.'),
      hint('agents-count', `${s.workers.filter(w => w.status === 'running').length} em execução · ${s.workers.length} total`),
      button('agents-refresh', 'Atualizar registros de agentes', () => collectWorkers($)),
      button('native-tasks', 'Abrir /tasks nativo', () => $.command.run({ command: 'tasks', args: '' })),
      <Input key="agent-filter" label="Filtro" value={s.filter} submitLabel="filtrar" onSubmit={filter => update($, state, x => ({ ...x, filter }))} />,
      s.workerError && <Text key="agent-error" color="warning">{s.workerError}</Text>,
      ...visible.slice(-12).map(w => button(`worker-${w.id}`, `${w.name ?? label(w.type)} · ${label(w.status)} · ${w.description || w.id}`, () => update($, state, x => ({ ...x, selected: x.selected === w.id ? null : w.id })))),
      visible.length === 0 && hint('no-workers', 'Nenhum agente corresponde ao filtro.'),
      selected && <Box key="selected-worker" flexDirection="column"><Text bold>{label(selected.type)} · {label(selected.status)}</Text><Text dimColor>{selected.model ?? 'modelo não observado'} · esforço {selected.effort ? label(selected.effort) : 'não observado'}</Text><Text>{selected.summary ?? 'Resultado não observado.'}</Text></Box>,
    ]
  }
  return <Box flexDirection="column" paddingX={1} gap={1} width={e.props.bodyColumns}>
    <Box justifyContent="space-between"><Text bold color="claude">Dev Control · {label(s.screen)}</Text>{s.screen !== 'home' && button('back', '← Voltar', () => visit($, 'home'))}</Box>
    {rows}<Box justifyContent="space-between">{button('close', 'Fechar', () => close($))}<Text dimColor>↑↓ navegar · Enter selecionar</Text></Box>
  </Box>
}
async function drawStatus($: Host, e: RenderInput<'PromptHint'>) {
  const { Box, Text, Button } = $.ui.resolve(e); const s = await read($, state)
  const columns = e.viewport?.columns ?? 100
  const narrow = columns < 70
  const fields = ['context', '5h', '7d'].map(key => {
    const r = s.usage?.readings.find(v => v.key === key)
    return `${key === 'context' ? 'Contexto' : key === '7d' ? '7 dias' : key} ${meter(r?.value, columns > 110 ? 8 : 5)}`
  }).join(narrow ? '\n' : ' · ')
  const head = s.usage ? `${s.usage.model} · ${s.usage.directory.split(/[\\/]/).filter(Boolean).at(-1)}${s.usage.branch ? ` · ${s.usage.branch}` : ''}` : 'Aguardando dados de consumo'
  return <Box flexGrow={1} flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={1}><Text>{columns > 160 ? `${head} │ ` : ''}{fields}{s.error ? ' · desatualizado' : ''}</Text>
    <Button key="dashboard-open" plain label="◆ Dev Control" onPress={() => s.screen === null ? open($) : close($)} /></Box>
}
async function drawProgress($: Host, e: RenderInput<'AbovePrompt'>) {
  const s = await read($, state); if (!s.prefs.focus || !s.plan || e.props.hasSurvey) return null
  const { Box, Text, Button } = $.ui.resolve(e); const p = s.plan; const percent = percentage(p)
  return <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
    <Box justifyContent="space-between"><Text bold>{p.title}</Text><Text>{label(p.state)} · {percent === null ? 'n/d' : `${percent}% · ${meter(percent).split(' ')[0]}`}</Text></Box>
    {p.steps.slice(0, 5).map((step, i) => <Text key={`progress-${i}`} color={step.state === 'error' ? 'error' : step.state === 'active' ? 'claude' : undefined}>{label(step.state)}: {step.title}</Text>)}
    {p.steps.length > 5 && <Text dimColor>{p.steps.length - 5} outras etapas no painel</Text>}
    <Button key="progress-details" plain label={s.prefs.details ? 'Recolher detalhes' : 'Mostrar detalhes'} onPress={() => patchPreferences($, { details: !s.prefs.details })} />
  </Box>
}
async function begin($: Host, title: string) {
  const plan: Plan = { title, steps: [], state: 'working', started: await clock($), stopped: null }
  await update($, state, s => ({ ...s, plan }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await restorePreferences($).catch(error => $.ui.toast(`Falha ao carregar perfil: ${String(error)}`))
    await measure($)
    await $.command.register({ name: 'dev-control', description: 'Painel Dev Control de Bruno', argumentHint: '[consumo|notificacoes|zen|temas|modelo|perfis|agentes|continuidade]', immediate: true })
    await $.tool.register({ name: 'progress_report', description: 'Informe o progresso real da tarefa principal. Etapas concluídas devem corresponder a trabalho verificado. Escreva os títulos em português, salvo orientação diferente do usuário.', inputSchema: {
      type: 'object', properties: { title: { type: 'string' }, state: { type: 'string', enum: ['working', 'waiting', 'error'] },
        steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, state: { type: 'string', enum: ['pending', 'active', 'done', 'error', 'blocked'] } }, required: ['title', 'state'] } } }, required: ['steps'] } })
    refreshTimer?.cancel(); displayTimer?.cancel()
    refreshTimer = $.clock.every(15000, () => { void poll($).catch(() => {}) })
    displayTimer = $.clock.every(1000, () => { void clock($).then(clock => update($, state, s => s.screen !== null || s.prefs.focus && s.plan?.state === 'working' ? { ...s, clock } : s)) })
    return result
  })
  on('session.end', async ($, e, next) => { refreshTimer?.cancel(); displayTimer?.cancel(); refreshTimer = undefined; displayTimer = undefined; await windowsAppearance($, null).catch(() => {}); return next(e) })
  on('command.run', { command: 'dev-control' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (arg === 'handoff' || arg === 'continuidade') { await continuity($); return { text: 'Solicitação de continuidade preparada.' } }
    const pages: Record<string, Screen> = { consumo: 'usage', notificacoes: 'notices', temas: 'appearance', modelo: 'model', perfis: 'profiles', agentes: 'agents', usage: 'usage', notifications: 'notices', zen: 'focus', themes: 'appearance', mode: 'model', profiles: 'profiles', agents: 'agents' }
    await open($, pages[arg] ?? 'home'); return { text: 'Dev Control aberto.' }
  })
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => await drawPanel($, e) ?? $.ui.resolve(e).Text({ children: '' }))
  on('ui.close', { id: PANEL }, async ($, e, next) => { const r = await next(e); await update($, state, s => ({ ...s, screen: null })); return r }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'PromptHint' }, ($, e) => drawStatus($, e))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => await drawProgress($, e) ?? next(e))
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const cfg = (await read($, state)).prefs
    return cfg.focus && !cfg.details && !e.props.isErrored && !e.props.isInterrupted && !failure(e.props.output) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e)
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => { const cfg = (await read($, state)).prefs; return cfg.focus && !cfg.details && !e.props.isErrored && !failure(e.props.output) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e) })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => { const cfg = (await read($, state)).prefs; return cfg.focus && !cfg.details && !e.props.calls.some(c => c.isErrored || c.isInterrupted || failure(c.output)) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e) })
  on('prompt.submit', async ($, e, next) => {
    const cfg = (await read($, state)).prefs
    if (!cfg.focus || e.origin.kind !== 'composer' || !e.text.trim() || e.text.trim().startsWith('/')) return next(e)
    await begin($, e.text.split('\n')[0].slice(0, 140))
    return next({ ...e, context: [...e.context ?? [], 'O foco do Dev Control está ativo. Use mcp__dev-control__progress_report para informar o plano real e atualizar suas etapas. Os estados da API são pending, active, done, error, blocked. Marque done somente após verificar a conclusão; informe waiting ou error quando necessário. Escreva os títulos em português, salvo orientação diferente do usuário. Os detalhes das ferramentas podem estar recolhidos; explique brevemente as ações e descobertas relevantes.'] })
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'mcp__dev-control__progress_report' }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'O progresso dos subagentes é separado do plano principal.' }
    const report = e as unknown as { title?: string; steps?: unknown; state?: string }
    const current = (await read($, state)).plan
    if (!current) await begin($, report.title || 'Tarefa')
    await update($, state, s => ({ ...s, plan: s.plan ? { ...s.plan, title: typeof report.title === 'string' ? report.title.slice(0, 300) : s.plan.title,
      steps: steps(report.steps), state: report.state === 'waiting' || report.state === 'error' ? report.state : 'working' } : null }))
    return { result: 'Progresso registrado.' }
  })
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || result.isError || result.deny || !(await read($, state)).prefs.focus) return result
    const entries = e.todos.map((todo, i) => ({ id: String(i), title: todo.content,
      state: todo.status === 'completed' ? 'done' as const : todo.status === 'in_progress' ? 'active' as const : 'pending' as const }))
    if (!(await read($, state)).plan) await begin($, 'Lista de tarefas')
    await update($, state, s => ({ ...s, plan: s.plan ? { ...s.plan, steps: entries } : null }))
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || result.isError || result.deny || !(await read($, state)).prefs.focus) return result
    const id = (result.result as { task?: { id?: string } })?.task?.id
    if (!id) return result
    if (!(await read($, state)).plan) await begin($, e.subject)
    await update($, state, s => ({ ...s, plan: s.plan ? { ...s.plan, steps: [...s.plan.steps.filter(step => step.id !== id), { id, title: e.subject, state: 'pending' }] } : null }))
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || result.isError || result.deny || !(await read($, state)).prefs.focus) return result
    await update($, state, s => ({ ...s, plan: s.plan ? { ...s.plan, steps: e.status === 'deleted' ? s.plan.steps.filter(step => step.id !== e.taskId) :
      s.plan.steps.map(step => step.id === e.taskId ? { ...step, title: e.subject ?? step.title,
        state: e.status === 'completed' ? 'done' : e.status === 'in_progress' ? 'active' : e.status === 'pending' ? 'pending' : step.state } : step) } : null }))
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', async ($, e, next) => { const r = await next(e); if (r.isError || r.deny) void notice($, 'failures', `Ferramenta ${e.tool} informou erro ou recusa. Confira os detalhes visíveis.`); return r })
  on('agent.spawn', async ($, e, next) => { const r = await next(e); if (r.agentId) await observe($, r.agentId, { type: e.subagentType, description: e.description, model: r.model, status: 'running' }).catch(() => {}); return r })
  on('turn.step', async function* ($, e, next) {
    const cfg = (await read($, state)).prefs
    const override = cfg.effort !== null && e.effort !== undefined && (e.agentId === undefined || cfg.workerEffort)
    const effort = override ? cfg.effort! : e.effort
    const result = yield* next(override ? { ...e, effort } : e)
    if (e.agentId !== undefined) await observe($, e.agentId, { model: e.model, effort: effort === undefined ? undefined : String(effort), status: 'running' }).catch(() => {})
    else {
      if (result.usage != null) { const at = await clock($); await update($, state, s => ({ ...s, lastReply: at })) }
      void measure($).catch(() => {})
    }
    return result
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) { await observe($, e.agentId, { status: e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed', summary: e.answer.slice(0, 1000) }).catch(() => {}); return result }
    const at = await clock($)
    await update($, state, s => ({ ...s, plan: s.plan ? endPlan(s.plan, e.reason, at) : null }))
    if (e.reason === 'answer') void notice($, 'response', 'A resposta principal terminou. Ainda pode haver tarefas pendentes.')
    else if (e.reason === 'error' || e.reason === 'refusal') void notice($, 'failures', 'A resposta principal terminou com erro ou recusa.')
    void measure($).catch(() => {})
    return result
  })
  on('classic.Notification', ($, e, next) => { if (['permission_prompt', 'idle_prompt', 'elicitation_dialog'].includes(e.notification_type)) void notice($, 'input', 'O Claude Code está aguardando sua resposta.'); return next(e) })
  on('classic.UserPromptSubmit', async ($, e, next) => { await update($, state, s => ({ ...s, permission: e.permission_mode })); return next(e) }).catch(($, e, next) => next(e))
}
async function poll($: Host) {
  const s = await read($, state), time = await clock($)
  if (!s.usage || time - s.usage.checked >= s.prefs.interval * 1000) await measure($)
  if (s.screen === 'agents') await collectWorkers($)
}
