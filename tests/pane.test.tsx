import { expect, test } from 'claude-code/testing'

import type { StatusData } from '../hooks/register'
import { age, BLUE, BSN_LIME, citedKey, countdown, DEFAULT_CONFIG, duration, jiraKeyFromBranch, nextAlert, pace, parseJiraKey, pickMine, resetLabel, statusText } from '../hooks/register'

const PANE = {
  plugin: 'uso-monitor',
  component: 'Pane',
  requestId: 'uso-monitor',
  props: {
    title: 'Uso',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString()


/** Stands in for the engine under everything the mod asks at start. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function engine(on: any, rateLimits: unknown[], saved?: unknown, kept?: Record<string, unknown>) {
  on('command.register', () => ({ value: { command: 'uso' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: 63 }, rateLimits, cost: { usd: 1.234 } },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: 'D:\\PIVOTTO\\FLOW' }))
  on('settings.read', () => ({ value: { effortLevel: 'medium' } }))
  on('store.get', (_: unknown, e: any) => ({ value: (e as { key: string }).key === 'last-reading' ? saved : undefined }))
  on('store.set', (_: unknown, e: any) => {
    if (kept) kept[(e as { key: string }).key] = (e as { value: unknown }).value
    return { value: undefined }
  })
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'x', type: 'Explore', status: 'running' }] }))
  on('process.run', (_: unknown, e: any) => {
    const sub = (e as { argv: string[] }).argv[1]
    const out = sub === 'branch' ? 'main\n' : (e as { argv: string[] }).argv.includes('--cached') ? 'a\n' : 'b\nc\n'
    return { value: { exitCode: 0, stdout: out, stderr: '' } }
  })
}

test('the pane shows each window with its percent and when it ends, on every surface', async ($, on) => {
  engine(on, [
    { kind: 'seven_day', percentUsed: 61.5, resetsAt: inMs(3 * 86_400_000) },
    { kind: 'five_hour', percentUsed: 42, resetsAt: inMs(2 * 3_600_000 + 15 * 60_000) },
  ])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Sessão (5h)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Semana (7d)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /termina hoje|termina amanhã/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /atualizado agora/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane shows the status line figures: model, effort, context, cost, folder, git', async ($, on) => {
  engine(on, [{ kind: 'five_hour', percentUsed: 10, resetsAt: inMs(3_600_000) }])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'opus-5-5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'medium' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '63%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'FLOW' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'main +1 ~2' })).toBeDefined()
  await ui.unmount()
})

test('with no reading yet, the last session\'s saved reading is shown and marked', async ($, on) => {
  engine(on, [], {
    limits: [{ kind: 'five_hour', percentUsed: 33, resetsAt: inMs(3_600_000) }],
    readAt: Date.now() - 12 * 60_000,
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '33%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /leitura da sessão anterior, há 12 min/ })).toBeDefined()
  await ui.unmount()
})

test('the pane says when there is no reading at all', async ($, on) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Sem leitura de uso ainda.' })).toBeDefined()
  await ui.unmount()
})

const BASE = new Date(2026, 10, 16, 10, 0).getTime()
const sample = (over: Partial<StatusData> = {}): StatusData => ({
  list: [
    { kind: 'seven_day', percentUsed: 61.5, resetsAt: new Date(2026, 10, 21, 14, 0).toISOString() },
    { kind: 'five_hour', percentUsed: 30, resetsAt: new Date(2026, 10, 16, 13, 0).toISOString() },
  ],
  i: { model: 'opus-5-5', effort: 'medium', contextPct: 63, costUsd: 1.5, dir: 'FLOW', branch: 'main', staged: 1, modified: 2 },
  nowMs: BASE,
  saved: false,
  startedAt: BASE - 72 * 60_000,
  agents: 0,
  tasks: {},
  config: DEFAULT_CONFIG,
  ...over,
})

test('full layout: aligned columns, pace, time and cost per hour', () => {
  const lines = statusText(sample()).split('\n')
  expect(lines.length).toBe(3)
  expect(lines[0]).toBe('◆ opus-5-5  │  ≡ medium      │  ◧ 63%  │  ◎ $1.50')
  expect(lines[1]).toBe('◷ 5h ███░░░░░░░ 30%  ↻ 13:00 · ritmo ok  │  ▦ 7d ██████░░░░ 62%  ↻ sáb 14:00 · ▲ esgota amanhã 13:32')
  expect(lines[2]).toBe('⌂ FLOW      │  ⎇ main +1 ~2  │  ◴ 1h 12min · $1.25/h')
  expect(lines[0]?.indexOf('│')).toBe(lines[2]?.indexOf('│'))
})

test('activity line shows live agents and open tasks only when there are any', () => {
  const lines = statusText(sample({ agents: 2, tasks: { 'task:1': 'in_progress', 'task:2': 'pending', 'todo:0': 'completed' } })).split('\n')
  expect(lines.length).toBe(4)
  expect(lines[3]).toContain('⚙ 2 agentes')
  expect(lines[3]).toContain('☐ 2 tarefas (1 em andamento)')
})

test('context warning at 80% and config toggles turn items off', () => {
  expect(statusText(sample({ i: { ...sample().i, contextPct: 84 } }))).toContain('◧ 84% · ▲ compacta em breve')
  const off = { ...DEFAULT_CONFIG, ritmo: false, tempo: false, contexto: false }
  const text = statusText(sample({ i: { ...sample().i, contextPct: 84 }, config: off }))
  expect(text).not.toContain('ritmo')
  expect(text).not.toContain('esgota')
  expect(text).not.toContain('◴')
  expect(text).not.toContain('compacta')
})

test('one compact line while typing or where the full lines do not fit', () => {
  const typing = statusText(sample(), { isDraft: true })
  expect(typing).toBe('◆ opus-5-5  │  ◧ 63%  │  ◷ 5h ██░░░ 30%  │  ▦ 7d ███░░ 62%  │  ◎ $1.50')
  expect(statusText(sample(), { columns: 60 })).toBe(typing)
  expect(statusText(sample(), { columns: 200 }).split('\n').length).toBe(3)
  expect(statusText(sample({ config: { ...DEFAULT_CONFIG, compacto: false } }), { isDraft: true }).split('\n').length).toBe(3)
})

test('pace: ok, runs out, or too early to tell', () => {
  const H = 3_600_000
  expect(pace(30, BASE + 3 * H, BASE, 5 * H)).toEqual({ ok: true })
  expect(pace(80, BASE + 3 * H, BASE, 5 * H)).toEqual({ ok: false, emptyAt: BASE + 0.5 * H })
  expect(pace(5, BASE + 4.9 * H, BASE, 5 * H)).toBeUndefined()
  expect(duration(72 * 60_000)).toBe('1h 12min')
  expect(duration(45 * 60_000)).toBe('45min')
})

test('under the prompt: blue text, bars colored by state, engine hint kept', async ($, on) => {
  engine(on, [
    { kind: 'five_hour', percentUsed: 42, resetsAt: inMs(3_600_000) },
    { kind: 'seven_day', percentUsed: 95, resetsAt: inMs(3 * 86_400_000) },
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'uso-monitor',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  const texts = await ui.findAll({ type: 'Text' })
  const colorOf = (t: string) => texts.find(n => n.text === t)?.props.color
  expect(colorOf('opus-5-5')).toBe(BLUE.accent)
  expect(colorOf('medium')).toBe(BLUE.value)
  expect(colorOf(' 42%')).toBe('#4CC38A')
  expect(colorOf(' 95%')).toBe('#EF5F5F')
  expect(colorOf('█▀▀▀▀▀█  ▄█▀▀▀▀▀  █▀█   █')).toBe(BSN_LIME)
  expect(colorOf('█▄▄▄▄▄█  ▄▄▄▄▄█▀  █    ▀█')).toBe(BSN_LIME)
  await ui.unmount()
})

test('alerts fire once per threshold', () => {
  expect(nextAlert(79, 0)).toBeUndefined()
  expect(nextAlert(80, 0)).toBe(80)
  expect(nextAlert(85, 80)).toBeUndefined()
  expect(nextAlert(93, 80)).toBe(90)
  expect(nextAlert(95, 0)).toBe(90)
  expect(nextAlert(99, 90)).toBeUndefined()
})

test('countdown, reset and age labels read in Portuguese', () => {
  const base = new Date(2026, 10, 16, 10, 0).getTime()
  expect(countdown(base + (2 * 60 + 15) * 60_000, base)).toBe('em 2h 15min')
  expect(countdown(base + (3 * 24 + 4) * 3_600_000, base)).toBe('em 3d 4h')
  expect(countdown(base + 12 * 60_000, base)).toBe('em 12min')
  expect(resetLabel(new Date(2026, 10, 16, 18, 40).getTime(), base)).toBe('hoje 18:40')
  expect(resetLabel(new Date(2026, 10, 17, 9, 0).getTime(), base)).toBe('amanhã 09:00')
  expect(resetLabel(new Date(2026, 10, 21, 14, 0).getTime(), base)).toBe('sáb 21/11 14:00')
  expect(age(base - 30_000, base)).toBe('agora')
  expect(age(base - 12 * 60_000, base)).toBe('há 12 min')
  expect(age(base - 185 * 60_000, base)).toBe('há 3h 05min')
})

test('/uso config lists the toggles, turns one off and keeps it', async ($, on) => {
  const kept: Record<string, unknown> = {}
  engine(on, [{ kind: 'five_hour', percentUsed: 30, resetsAt: inMs(3_600_000) }], undefined, kept)
  const uso = (args: string) =>
    $.command.run({
      command: 'uso',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    } as Parameters<typeof $.command.run>[0])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const list = await uso('config')
  expect(list.text).toContain('● ritmo')

  const off = await uso('config ritmo off')
  expect(off.text).toContain('ritmo desligado')
  expect(off.text).toContain('○ ritmo')
  expect((kept.config as { ritmo: boolean }).ritmo).toBe(false)

  const bad = await uso('config cor azul')
  expect(bad.text).toContain('Não entendi')
})

test('a Jira key is read from the branch name and from what is typed', () => {
  expect(jiraKeyFromBranch('feature/CARPA-127-esteira')).toBe('CARPA-127')
  expect(jiraKeyFromBranch('carpa-127')).toBe('CARPA-127')
  expect(jiraKeyFromBranch('bugfix/KOI_42_login')).toBe(undefined)
  expect(jiraKeyFromBranch('bugfix/KOI-42_login')).toBe('KOI-42')
  expect(jiraKeyFromBranch('main')).toBe(undefined)
  expect(jiraKeyFromBranch(undefined)).toBe(undefined)
  expect(parseJiraKey('carpa-127')).toBe('CARPA-127')
  expect(parseJiraKey('https://bsntecnologia.atlassian.net/browse/CARPA-127')).toBe('CARPA-127')
  expect(parseJiraKey('qualquer')).toBe(undefined)
})

test('the Jira line shows key, title, status and assignee, and hides when off', () => {
  const jira = {
    key: 'CARPA-127',
    summary: 'Criar Protótipo da Esteira de Cadastros',
    status: 'Desenvolvendo',
    category: 'Em andamento',
    assignee: 'Lucas Pivotto',
    priority: 'Média',
    fetchedAt: BASE,
    source: 'branch' as const,
  }
  const text = statusText(sample({ jira }))
  expect(text).toContain('◉ CARPA-127 Criar Protótipo da Esteira de Cadastros')
  expect(text).toContain('Desenvolvendo')
  expect(text).toContain('Lucas Pivotto · Média')
  expect(statusText(sample({ jira, config: { ...DEFAULT_CONFIG, jira: false } }))).not.toContain('CARPA-127')
  expect(statusText(sample({ jira: { key: 'CARPA-9', fetchedAt: 0, source: 'manual' } }))).toContain('CARPA-9 carregando…')
})

test('/uso jira pins a key and fetches it through the Atlassian connector', async ($, on) => {
  const kept: Record<string, unknown> = {}
  engine(on, [{ kind: 'five_hour', percentUsed: 30, resetsAt: inMs(3_600_000) }], undefined, kept)
  const asked: string[] = []
  on('mcp.call', (_: unknown, e: any) => {
    asked.push(e.tool)
    const body =
      e.tool === 'getAccessibleAtlassianResources'
        ? { data: { resources: [{ url: 'https://bsntecnologia.atlassian.net', products: [{ id: 'jira' }] }] } }
        : {
            data: {
              key: e.args.issueIdOrKey,
              fields: {
                summary: 'Criar Protótipo',
                status: { name: 'Desenvolvendo', statusCategory: { name: 'Em andamento' } },
                assignee: { displayName: 'Lucas Pivotto' },
                priority: { name: 'Média' },
              },
            },
          }
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const res = await $.command.run({
    command: 'uso',
    args: 'jira carpa-127',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  } as Parameters<typeof $.command.run>[0])
  expect(res.text).toContain('CARPA-127 · Criar Protótipo')
  expect(res.text).toContain('Responsável: Lucas Pivotto')
  expect(res.text).toContain('https://bsntecnologia.atlassian.net/browse/CARPA-127')
  expect(asked).toContain('getJiraIssue')
  expect(kept['jira-site']).toBe('bsntecnologia.atlassian.net')
})

test('with no pin, branch or cited key, my open issue being worked on is chosen', () => {
  const mine = [
    { key: 'CARPA-126', status: 'Aguardando merge request' },
    { key: 'CARPA-129', status: 'Desenvolvendo' },
    { key: 'CARPA-127', status: 'Desenvolvendo' },
  ]
  expect(pickMine(mine)?.key).toBe('CARPA-129')
  expect(pickMine([{ key: 'CARPA-126', status: 'Aguardando merge request' }])?.key).toBe('CARPA-126')
  expect(pickMine([])).toBe(undefined)
  const projects = new Set(['CARPA'])
  expect(citedKey('veja a carpa-127 e depois a CARPA-129', projects)).toBe('CARPA-129')
  expect(citedKey('arquivo em UTF-8 na porta 8080', projects)).toBe(undefined)
})

test('the issue shows by itself at start: my most recent open issue being worked on', async ($, on) => {
  engine(on, [{ kind: 'five_hour', percentUsed: 30, resetsAt: inMs(3_600_000) }])
  on('mcp.call', (_: unknown, e: any) => {
    const issue = (key: string, status: string) => ({
      key,
      fields: { summary: `Tarefa ${key}`, status: { name: status, statusCategory: { name: 'Em andamento' } }, assignee: { displayName: 'Lucas Pivotto' } },
    })
    const body =
      e.tool === 'getAccessibleAtlassianResources'
        ? { data: { resources: [{ url: 'https://bsntecnologia.atlassian.net', products: [{ id: 'jira' }] }] } }
        : e.tool === 'searchJiraIssuesUsingJql'
          ? { data: { issues: [issue('CARPA-126', 'Aguardando merge request'), issue('CARPA-129', 'Desenvolvendo')] } }
          : { data: issue(e.args.issueIdOrKey, 'Desenvolvendo') }
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const res = await $.command.run({
    command: 'uso',
    args: 'jira',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  } as Parameters<typeof $.command.run>[0])
  expect(res.text).toContain('CARPA-129 · Tarefa CARPA-129')
  expect(res.text).toContain('sua tarefa em andamento mais recente')
})
