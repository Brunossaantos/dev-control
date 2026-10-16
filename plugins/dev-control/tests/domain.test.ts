import { describe, test, expect } from 'claude-code/testing'
import { defaults, preferences, projectKey, bands, alerts, percentage, endPlan, steps, failure, numberLabel, remaining, jsonc, PALETTES, shade, meter, usageColor } from '../hooks/domain'
import type { Plan } from '../types'

describe('preferências e aparência', () => {
  test('som e avisos do sistema exigem ativação explícita', () => {
    expect(defaults().channels).toEqual({ terminal: true, audio: false, desktop: false })
    expect(defaults().workerEffort).toBe(false)
  })
  test('faixas rejeitam valores inválidos e ordenam valores válidos', () => {
    expect(bands('95, 70, 85, 70')).toEqual([70, 85, 95])
    for (const invalid of ['', '0', '101', '70,,85', 'NaN', '70.5', '-1', '1,2,3,4,5,6,7']) expect(bands(invalid)).toBeNull()
  })
  test('preferências inválidas preservam os padrões', () => {
    const p = preferences({ channels: { audio: 'true' }, interval: -100, cooldown: Infinity, levels: [200], effort: 'invalid', accent: '<script>' })
    expect(p.channels.audio).toBe(false); expect(p.interval).toBe(15); expect(p.cooldown).toBe(60)
    expect(p.levels).toEqual([70, 85, 95]); expect(p.effort).toBeNull(); expect(p.accent).toBe('#38BDF8')
  })
  test('preferências independentes não compartilham dados internos', () => {
    const a = defaults(), b = defaults(); a.channels.audio = true; a.levels.push(99)
    expect(b.channels.audio).toBe(false); expect(b.levels).toEqual([70, 85, 95])
  })
  test('caminhos Windows são normalizados e Linux preserva maiúsculas', () => {
    expect(projectKey('C:\\Projects\\Demo\\')).toBe('c:/projects/demo')
    expect(projectKey('/Work/Demo/')).toBe('/Work/Demo')
  })
  test('JSONC preserva strings e aspas escapadas', () => {
    const text = '{ // note\n "url":"https://test/a//b", "quote":"\\\"//", /* note */ "list":[1,2,], }'
    expect(jsonc(text)).toEqual({ url: 'https://test/a//b', quote: '"//', list: [1, 2] })
    expect(jsonc('{"value":1, // after comma\n}')).toEqual({ value: 1 })
  })
  test('paletas usam o formato nativo suportado', () => {
    expect(shade(PALETTES.find(p => p.id === 'paper')!).base).toBe('light')
    expect(shade(PALETTES.find(p => p.id === 'ocean')!).base).toBe('dark')
    expect(shade(PALETTES[0]).overrides.claude).toBe(PALETTES[0].accent)
  })
})
describe('transições de consumo', () => {
  test('cruzar várias faixas produz um único alerta da maior faixa', () => {
    const first = alerts([{ key: '5h', value: 99, reset: 'window1' }], {}, [70, 85, 95])
    expect(first.messages).toEqual(['Limite de 5h: 99% (faixa 95%)'])
    expect(alerts([{ key: '5h', value: 100, reset: 'window1' }], first.memory, [70, 85, 95]).messages).toEqual([])
  })
  test('novas janelas e faixas alteradas rearmam alertas', () => {
    const first = alerts([{ key: '7d', value: 85, reset: 'window1' }], {}, [70, 85])
    expect(alerts([{ key: '7d', value: 85, reset: 'window2' }], first.memory, [70, 85]).messages.length).toBe(1)
    expect(alerts([{ key: '7d', value: 85, reset: 'window1' }], first.memory, [80]).messages.length).toBe(1)
  })
  test('leituras ausentes preservam a memória de alertas', () => {
    const first = alerts([{ key: '5h', value: 85, reset: 'a' }], {}, [70])
    expect(alerts([{ key: '5h', value: null, reset: 'a' }], first.memory, [70]).memory).toEqual(first.memory)
    expect(alerts([{ key: '5h', value: NaN, reset: 'a' }], first.memory, [70]).messages.length).toBe(0)
  })
  test('compactação reinicia faixas sem repetir pequenas correções', () => {
    let x = alerts([{ key: 'context', value: 86, reset: 'session' }], {}, [70, 85])
    x = alerts([{ key: 'context', value: 84, reset: 'session' }], x.memory, [70, 85])
    expect(x.messages.length).toBe(0)
    x = alerts([{ key: 'context', value: 30, reset: 'session' }], x.memory, [70, 85])
    expect(alerts([{ key: 'context', value: 75, reset: 'session' }], x.memory, [70, 85]).messages.length).toBe(1)
  })
  test('janelas independentes geram avisos independentes', () => {
    expect(alerts([{ key: '5h', value: 80, reset: 'a' }, { key: '7d', value: 90, reset: 'b' }], {}, [70, 85]).messages.length).toBe(2)
  })
  test('contagem e tokens não inventam dados ausentes', () => {
    expect(numberLabel(null)).toBe('n/d'); expect(numberLabel(22000)).toBe('22k')
    expect(remaining(null, 0)).toBe('não informado'); expect(remaining('not-a-date', 0)).toBe('não informado')
  })
})
describe('estados de progresso', () => {
  const plan: Plan = { title: 'Task', state: 'working', started: 0, stopped: null, steps: [{ title: 'Read', state: 'done' }, { title: 'Check', state: 'pending' }] }
  test('fim da resposta preserva trabalho incompleto', () => {
    const p = endPlan(plan, 'answer', 100)
    expect(p.state).toBe('waiting'); expect(percentage(p)).toBe(50)
  })
  test('sucesso, cancelamento e erros têm estados distintos', () => {
    expect(endPlan({ ...plan, steps: [{ title: 'Finished', state: 'done' }] }, 'answer', 100).state).toBe('done')
    expect(endPlan(plan, 'aborted', 100).state).toBe('interrupted')
    expect(endPlan(plan, 'error', 100).state).toBe('error')
    expect(endPlan(plan, 'refusal', 100).state).toBe('error')
  })
  test('plano vazio não possui percentual calculável', () => { expect(percentage({ ...plan, steps: [] })).toBeNull() })
  test('espera explícita e etapas com erro permanecem visíveis', () => {
    expect(endPlan({ ...plan, state: 'waiting', steps: [{ title: 'Done', state: 'done' }] }, 'answer', 100).state).toBe('waiting')
    expect(endPlan({ ...plan, steps: [{ title: 'Test', state: 'error' }] }, 'answer', 100).state).toBe('error')
  })
  test('progresso inválido e falha de processo são tratados', () => {
    expect(steps([null, { title: 'A', state: 'invalid' }])).toEqual([{ title: 'A', state: 'pending' }])
    expect(failure({ exitCode: 1 })).toBe(true); expect(failure({ exitCode: 0 })).toBe(false)
    expect(failure({ interrupted: true })).toBe(true)
  })
})

describe('barras de consumo', () => {
  test('barras representam limites, valores intermediários e dados ausentes', () => {
    expect(meter(0, 4)).toBe('░░░░ 0%')
    expect(meter(50, 4)).toBe('██░░ 50%')
    expect(meter(99, 4)).toBe('███░ 99%')
    expect(meter(100, 4)).toBe('████ 100%')
    expect(meter(120, 4)).toBe('████ 100%')
    expect(meter(-10, 4)).toBe('░░░░ 0%')
    expect(meter(null)).toBe('n/d')
    expect(meter(undefined)).toBe('n/d')
    expect(meter(NaN)).toBe('n/d')
  })
})

describe('cores do consumo', () => {
  test('verde abaixo de 70, amarelo a partir de 70 e vermelho a partir de 90', () => {
    expect(usageColor(0)).toBe('#22C55E')
    expect(usageColor(69.99)).toBe('#22C55E')
    expect(usageColor(70)).toBe('#EAB308')
    expect(usageColor(89.99)).toBe('#EAB308')
    expect(usageColor(90)).toBe('#EF4444')
    expect(usageColor(100)).toBe('#EF4444')
    expect(usageColor(null)).toBeUndefined()
    expect(usageColor(undefined)).toBeUndefined()
    expect(usageColor(NaN)).toBeUndefined()
  })
})
