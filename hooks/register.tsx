import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Config, Info, Limit, TaskState } from '../types'

const PANE = 'uso-monitor'
const TITLE = 'Uso'
const STORE_LAST = 'last-reading'
const STORE_ALERTS = 'alerts'
const STORE_CONFIG = 'config'
const ALERT_AT = [80, 90]

// Change a tag when the stored value's fields change: an older value is then declined.
const limits = atom({ plugin: 'uso-monitor', key: 'limits' } as const, [], { shape: 'limits-1' })
const readAt = atom({ plugin: 'uso-monitor', key: 'readAt' } as const, 0, { shape: 'readAt-1' })
const isSaved = atom({ plugin: 'uso-monitor', key: 'isSaved' } as const, false, { shape: 'isSaved-1' })
const info = atom({ plugin: 'uso-monitor', key: 'info' } as const, {}, { shape: 'info-1' })
const now = atom({ plugin: 'uso-monitor', key: 'now' } as const, 0, { shape: 'now-1' })
const startedAt = atom({ plugin: 'uso-monitor', key: 'startedAt' } as const, 0, { shape: 'startedAt-1' })
const agents = atom({ plugin: 'uso-monitor', key: 'agents' } as const, 0, { shape: 'agents-1' })
const tasks = atom({ plugin: 'uso-monitor', key: 'tasks' } as const, {}, { shape: 'tasks-1' })
const config = atom({ plugin: 'uso-monitor', key: 'config' } as const, {}, { shape: 'config-1' })

const LABELS: Record<string, string> = {
  five_hour: 'Sessão (5h)',
  seven_day: 'Semana (7d)',
  seven_day_opus: 'Semana Opus',
  seven_day_sonnet: 'Semana Sonnet',
  spend_limit: 'Limite de gastos',
}
/** One-cell monochrome symbols: clean in JetBrains Mono, no emoji. */
const ICONS: Record<string, string> = {
  five_hour: '◷',
  seven_day: '▦',
  seven_day_opus: '◈',
  seven_day_sonnet: '◈',
  spend_limit: '¤',
}
const ICON = {
  ends: '↻',
  fresh: '⟳',
  model: '◆',
  effort: '≡',
  context: '◧',
  cost: '◎',
  dir: '⌂',
  git: '⎇',
  alert: '▲',
  time: '◴',
  agent: '⚙',
  task: '☐',
} as const
const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'spend_limit']
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const pad = (n: number) => String(n).padStart(2, '0')
const labelOf = (kind: string) => LABELS[kind] ?? kind

/** "hoje 18:40", "amanhã 09:00" or "sex 21/11 14:00", in local time. */
export function resetLabel(resetMs: number, nowMs: number): string {
  const at = new Date(resetMs)
  const today = new Date(nowMs)
  const hhmm = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const dayDiff = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  )
  if (dayDiff === 0) return `hoje ${hhmm}`
  if (dayDiff === 1) return `amanhã ${hhmm}`
  return `${WEEKDAYS[at.getDay()]} ${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${hhmm}`
}

/** "em 2h 15min", "em 3d 4h", "em 12min". */
export function countdown(resetMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.ceil((resetMs - nowMs) / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `em ${d}d ${h}h`
  if (h > 0) return `em ${h}h ${pad(m)}min`
  return `em ${m}min`
}

/** "agora", "há 12 min", "há 3h 05min", "há 2d". */
export function age(thenMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - thenMs) / 60_000))
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins} min`
  if (mins < 1440) return `há ${Math.floor(mins / 60)}h ${pad(mins % 60)}min`
  return `há ${Math.floor(mins / 1440)}d`
}

/** The highest alert threshold `pct` has reached that `done` has not yet, or undefined. */
export function nextAlert(pct: number, done: number): number | undefined {
  const hit = ALERT_AT.filter(t => pct >= t).pop()
  return hit !== undefined && hit > done ? hit : undefined
}

const bar = (pct: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const tone = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')
const ctxTone = (pct: number) => (pct > 80 ? 'error' : pct > 50 ? 'warning' : 'success')

const sortLimits = (list: Limit[]) =>
  [...list].sort((a, b) => {
    const ia = ORDER.indexOf(a.kind)
    const ib = ORDER.indexOf(b.kind)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

const toLimits = (list: readonly SessionRateLimit[]): Limit[] =>
  list.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

type Saved = { limits: Limit[]; readAt: number }
const isSavedReading = (v: unknown): v is Saved =>
  typeof v === 'object' && v !== null && Array.isArray((v as Saved).limits) && typeof (v as Saved).readAt === 'number'

/** A fresh reading: show it, save it for the next session, toast a threshold crossed. */
async function takeReading($: EngineInterface, list: readonly SessionRateLimit[]) {
  if (list.length === 0) return
  const fresh = toLimits(list)
  const at = Date.now()
  await update($, limits, () => fresh)
  await update($, readAt, () => at)
  await update($, isSaved, () => false)
  await $.store.set(STORE_LAST, { limits: fresh, readAt: at })

  const stored = await $.store.get(STORE_ALERTS)
  const alerts: Record<string, number> = typeof stored === 'object' && stored !== null ? { ...(stored as Record<string, number>) } : {}
  let changed = false
  for (const l of fresh) {
    // One alert per threshold per window period: a new resetsAt starts over.
    const id = `${l.kind}@${l.resetsAt ?? ''}`
    const hit = nextAlert(l.percentUsed, alerts[id] ?? 0)
    if (hit === undefined) continue
    alerts[id] = hit
    changed = true
    const ends = l.resetsAt ? `, termina ${resetLabel(Date.parse(l.resetsAt), at)}` : ''
    $.ui.toast(`${ICON.alert} ${labelOf(l.kind)} passou de ${hit}% (${Math.round(l.percentUsed)}%)${ends}`, { timeoutMs: 8000 })
  }
  if (changed) {
    // Keep only the current periods' entries.
    const live = new Set(fresh.map(l => `${l.kind}@${l.resetsAt ?? ''}`))
    await $.store.set(STORE_ALERTS, Object.fromEntries(Object.entries(alerts).filter(([k]) => live.has(k))))
  }
}

/** Model, effort, context, cost, folder and git, as the status line shows them. */
async function readInfo($: EngineInterface, usage?: { context: { percent?: number }; cost?: { usd: number } }) {
  const [model, root, effort] = await Promise.all([
    $.session.model().catch(() => undefined),
    $.session.root().catch(() => undefined),
    $.settings.read({ key: 'effortLevel' }).catch(() => undefined),
  ])
  const next: Info = {
    model: model?.replace(/^claude-/, ''),
    effort: typeof effort === 'string' ? effort : undefined,
    contextPct: usage?.context.percent,
    costUsd: usage?.cost?.usd,
    dir: root?.split(/[\\/]/).filter(Boolean).pop(),
  }
  try {
    const head = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5000 })
    if (head.exitCode === 0) {
      next.branch = head.stdout.trim() || 'HEAD'
      const [staged, modified] = await Promise.all([
        $.process.run(['git', 'diff', '--cached', '--numstat'], { timeoutMs: 5000 }),
        $.process.run(['git', 'diff', '--numstat'], { timeoutMs: 5000 }),
      ])
      next.staged = staged.stdout.split('\n').filter(Boolean).length
      next.modified = modified.stdout.split('\n').filter(Boolean).length
    }
  } catch {
    // No git, or not a repository: the row says so.
  }
  await update($, info, () => next)
}


/** Blue scale for everything but the usage bars, dark to light. */
export const BLUE = {
  rule: '#2F4A6B', // separators
  icon: '#4F79A8', // icons
  label: '#6E9BD1', // secondary text
  value: '#A9CDF5', // values
  accent: '#5CB0FF', // model, branch, warnings
} as const
/** Only the usage bars change with the state. */
const STATE = { success: '#4CC38A', warning: '#E5C454', error: '#EF5F5F' } as const
const barColor = (pct: number) => STATE[tone(pct)]

export const DEFAULT_CONFIG: Config = {
  ritmo: true,
  contexto: true,
  atividade: true,
  tempo: true,
  compacto: true,
  alinhar: true,
}
const CONFIG_HELP: Record<keyof Config, string> = {
  ritmo: 'previsão de quando o limite acaba no ritmo atual',
  contexto: 'aviso quando o contexto está perto de compactar',
  atividade: 'linha de agentes e tarefas ativos',
  tempo: 'duração da sessão e custo por hora',
  compacto: 'uma linha só enquanto você digita',
  alinhar: 'separadores alinhados em colunas',
}
const isConfigKey = (k: string): k is keyof Config => k in DEFAULT_CONFIG

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
const CONTEXT_WARN = 80

export type Seg = { text: string; color: string; bold?: boolean }
/** One `│`-separated group of a line. */
type Group = Seg[]
/** A line: its groups, and whether its separators join the shared columns. */
type Line = { groups: Group[]; align: boolean }

const ico = (icon: string): Seg => ({ text: `${icon} `, color: BLUE.icon })
const SEP = '  │  '
const width = (g: Group) => g.reduce((n, s) => n + [...s.text].length, 0)

/** Short reset time: "18:40", "amanhã 09:00", "sex 14:00". */
export function shortReset(resetMs: number, nowMs: number): string {
  const label = resetLabel(resetMs, nowMs)
  return label.startsWith('hoje ') ? label.slice(5) : label.replace(/ \d\d\/\d\d /, ' ')
}

/** "1h 12min", "45min", "2d 3h". */
export function duration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${pad(mins % 60)}min`
  return `${mins}min`
}

/**
 * Where the current pace leads: `ok` when the window resets before the limit is
 * reached, else when it runs out. Undefined too early in the window to tell.
 */
export function pace(
  pct: number,
  resetMs: number,
  nowMs: number,
  windowMs: number,
): { ok: true } | { ok: false; emptyAt: number } | undefined {
  const elapsed = windowMs - (resetMs - nowMs)
  if (pct <= 0 || elapsed < windowMs * 0.05 || resetMs <= nowMs) return undefined
  if (pct >= 100) return { ok: false, emptyAt: nowMs }
  const emptyAt = nowMs + ((100 - pct) * elapsed) / pct
  return emptyAt < resetMs ? { ok: false, emptyAt } : { ok: true }
}

export type StatusData = {
  list: Limit[]
  i: Info
  nowMs: number
  saved: boolean
  startedAt: number
  agents: number
  tasks: Record<string, TaskState>
  config: Config
}

function usageGroups(d: StatusData, barWidth: number, withPace: boolean): Group[] {
  return sortLimits(d.list)
    .filter(l => WINDOW_MS[l.kind] !== undefined)
    .map(l => {
      const pct = Math.round(l.percentUsed)
      const resetMs = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      const g: Group = [
        ico(ICONS[l.kind] ?? '◇'),
        { text: `${l.kind === 'five_hour' ? '5h' : '7d'} `, color: BLUE.label },
        { text: bar(pct, barWidth), color: barColor(pct) },
        { text: ` ${pct}%`, color: barColor(pct), bold: true },
      ]
      if (!withPace || !Number.isFinite(resetMs)) return g
      g.push({ text: '  ', color: BLUE.rule }, ico(ICON.ends), {
        text: resetMs <= d.nowMs ? 'reiniciado' : shortReset(resetMs, d.nowMs),
        color: BLUE.label,
      })
      const p = d.config.ritmo ? pace(l.percentUsed, resetMs, d.nowMs, WINDOW_MS[l.kind] ?? 0) : undefined
      if (p?.ok) g.push({ text: ' · ritmo ok', color: BLUE.icon })
      if (p && !p.ok) g.push({ text: ` · ${ICON.alert} esgota ${shortReset(p.emptyAt, d.nowMs)}`, color: BLUE.accent, bold: true })
      return g
    })
}

/** The full layout: model, usage, place and time, activity. */
export function fullLines(d: StatusData): Line[] {
  const { i, config } = d
  const ctx = i.contextPct
  const top: Group[] = [
    [ico(ICON.model), { text: i.model ?? '–', color: BLUE.accent, bold: true }],
    ...(i.effort ? [[ico(ICON.effort), { text: i.effort, color: BLUE.value }]] : []),
    [
      ico(ICON.context),
      { text: ctx === undefined ? '–' : `${ctx}%`, color: BLUE.value },
      ...(config.contexto && ctx !== undefined && ctx >= CONTEXT_WARN
        ? [{ text: ` · ${ICON.alert} compacta em breve`, color: BLUE.accent, bold: true }]
        : []),
    ],
    [ico(ICON.cost), { text: `$${(i.costUsd ?? 0).toFixed(2)}`, color: BLUE.value }],
  ]

  const windows = usageGroups(d, 10, true)
  const mid: Group[] =
    windows.length === 0
      ? [[{ text: 'sem leitura de uso ainda', color: BLUE.label }]]
      : d.saved
        ? [...windows.slice(0, -1), [...(windows[windows.length - 1] ?? []), { text: '  (sessão anterior)', color: BLUE.icon }]]
        : windows

  const git: Group =
    i.branch === undefined
      ? [ico(ICON.git), { text: 'sem repositório', color: BLUE.label }]
      : [
          ico(ICON.git),
          { text: i.branch, color: BLUE.accent },
          ...(i.staged ? [{ text: ` +${i.staged}`, color: BLUE.value }] : []),
          ...(i.modified ? [{ text: ` ~${i.modified}`, color: BLUE.label }] : []),
        ]
  const bottom: Group[] = [[ico(ICON.dir), { text: i.dir ?? '–', color: BLUE.value }], git]
  if (config.tempo && d.startedAt > 0) {
    const ms = d.nowMs - d.startedAt
    const hours = ms / 3_600_000
    const perHour = hours >= 0.1 && i.costUsd !== undefined ? ` · $${(i.costUsd / hours).toFixed(2)}/h` : ''
    bottom.push([ico(ICON.time), { text: duration(ms), color: BLUE.value }, { text: perHour, color: BLUE.label }])
  }

  const lines: Line[] = [
    { groups: top, align: true },
    { groups: mid, align: false },
    { groups: bottom, align: true },
  ]
  const activity = activityGroups(d)
  if (activity.length > 0) lines.push({ groups: activity, align: true })
  return lines
}

function activityGroups(d: StatusData): Group[] {
  if (!d.config.atividade) return []
  const states = Object.values(d.tasks)
  const open = states.filter(s => s !== 'completed').length
  const active = states.filter(s => s === 'in_progress').length
  const groups: Group[] = []
  if (d.agents > 0)
    groups.push([ico(ICON.agent), { text: `${d.agents} ${d.agents === 1 ? 'agente' : 'agentes'}`, color: BLUE.value }])
  if (open > 0)
    groups.push([
      ico(ICON.task),
      { text: `${open} ${open === 1 ? 'tarefa' : 'tarefas'}`, color: BLUE.value },
      ...(active > 0 ? [{ text: ` (${active} em andamento)`, color: BLUE.label }] : []),
    ])
  return groups
}

/** One line: model, context, short usage bars, cost, activity. */
export function compactLine(d: StatusData): Line {
  const ctx = d.i.contextPct
  const groups: Group[] = [
    [ico(ICON.model), { text: d.i.model ?? '–', color: BLUE.accent, bold: true }],
    [ico(ICON.context), { text: ctx === undefined ? '–' : `${ctx}%`, color: BLUE.value }],
    ...usageGroups(d, 5, false),
    [ico(ICON.cost), { text: `$${(d.i.costUsd ?? 0).toFixed(2)}`, color: BLUE.value }],
    ...activityGroups(d),
  ]
  return { groups, align: false }
}

/** Pads each aligned line's groups so their separators fall in shared columns. */
function align(lines: Line[]): Seg[][] {
  const cols: number[] = []
  for (const line of lines)
    if (line.align) line.groups.slice(0, -1).forEach((g, n) => (cols[n] = Math.max(cols[n] ?? 0, width(g))))
  return lines.map(line =>
    line.groups.flatMap((g, n) => {
      const col = cols[n] ?? 0
      const padded =
        line.align && n < line.groups.length - 1 && col > width(g)
          ? [...g, { text: ' '.repeat(col - width(g)), color: BLUE.rule }]
          : g
      return n === 0 ? padded : [{ text: SEP, color: BLUE.rule }, ...padded]
    }),
  )
}

const plain = (segs: Seg[][]) => segs.map(l => l.map(s => s.text).join(''))

/**
 * What is drawn under the prompt for this width and draft state: the full
 * lines, or the compact one while typing or where the full ones don't fit.
 */
export function statusSegs(d: StatusData, opts: { columns?: number; isDraft?: boolean } = {}): Seg[][] {
  const lines = fullLines(d)
  const full = d.config.alinhar ? align(lines) : align(lines.map(l => ({ ...l, align: false })))
  const fits = opts.columns === undefined || plain(full).every(t => [...t].length <= opts.columns!)
  if (fits && !(opts.isDraft && d.config.compacto)) return full
  return align([compactLine(d)])
}

/** The lines as plain text (tests, logs). */
export const statusText = (d: StatusData, opts?: { columns?: number; isDraft?: boolean }) =>
  plain(statusSegs(d, opts)).join('\n')

async function statusData($: EngineInterface): Promise<StatusData> {
  const [list, i, saved, nowMs, start, agentCount, taskMap, cfg] = await Promise.all([
    read($, limits),
    read($, info),
    read($, isSaved),
    read($, now),
    read($, startedAt),
    read($, agents),
    read($, tasks),
    read($, config),
  ])
  return {
    list,
    i,
    saved,
    nowMs: nowMs || Date.now(),
    startedAt: start,
    agents: agentCount,
    tasks: taskMap,
    config: { ...DEFAULT_CONFIG, ...cfg },
  }
}

const LIVE_AGENT = new Set(['pending', 'running', 'waiting'])
async function refreshAgents($: EngineInterface) {
  const list = await $.agent.list().catch(() => [])
  const count = list.filter(a => LIVE_AGENT.has(a.status)).length
  await update($, agents, () => count)
}

/** `/uso config`: the toggles and how to change them. */
function configReport(cfg: Config): string {
  const rows = (Object.keys(DEFAULT_CONFIG) as (keyof Config)[]).map(
    k => `  ${cfg[k] ? '●' : '○'} ${k.padEnd(10)} ${CONFIG_HELP[k]}`,
  )
  return ['Configuração do uso-monitor:', ...rows, '', 'Mude com /uso config <item> on|off  (ex.: /uso config ritmo off)'].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'uso',
      description: 'Painel de uso; /uso config liga e desliga itens da linha sob o prompt',
    })

    const storedCfg = await $.store.get(STORE_CONFIG)
    if (typeof storedCfg === 'object' && storedCfg !== null)
      await update($, config, () => ({ ...DEFAULT_CONFIG, ...(storedCfg as Partial<Config>) }))

    const usage = await $.session.usage()
    await update($, startedAt, () => usage.startedAt)
    if (usage.rateLimits.length > 0) {
      await takeReading($, usage.rateLimits)
    } else {
      const saved = await $.store.get(STORE_LAST)
      if (isSavedReading(saved)) {
        await update($, limits, () => saved.limits)
        await update($, readAt, () => saved.readAt)
        await update($, isSaved, () => true)
      }
    }
    await readInfo($, usage)
    await refreshAgents($)
    await update($, now, () => Date.now())
    // Countdowns, pace, duration and live agents redraw every 15 s.
    $.clock.every(15_000, async () => {
      await update($, now, () => Date.now())
      await refreshAgents($)
    })

    // Lives under the prompt (PromptHint); the full pane opens only with /uso.
    $.ui.status(undefined)
    return started
  })

  on('command.run', { command: 'uso' }, async ($, e) => {
    const [sub, key, value] = e.args.trim().split(/\s+/)
    if (sub === 'config') {
      const cfg = { ...DEFAULT_CONFIG, ...(await read($, config)) }
      if (key === undefined) return { text: configReport(cfg) }
      if (!isConfigKey(key) || (value !== 'on' && value !== 'off'))
        return { text: `Não entendi. ${configReport(cfg)}` }
      const nextCfg = { ...cfg, [key]: value === 'on' }
      await update($, config, () => nextCfg)
      await $.store.set(STORE_CONFIG, nextCfg)
      return { text: `${key} ${value === 'on' ? 'ligado' : 'desligado'}.\n\n${configReport(nextCfg)}` }
    }
    const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
    return { text: isPlaced ? 'Painel de uso aberto.' : 'O painel de uso abre quando houver espaço na tela.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await takeReading($, e.rateLimits)
    await readInfo($, e)
    await update($, now, () => Date.now())
    return next(e)
  })

  // Tasks as the model keeps them: TaskCreate / TaskUpdate, or a TodoWrite list.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.deny === undefined && !ran.isError ? (ran.result as { task?: { id?: string } } | undefined)?.task?.id : undefined
    if (id) await update($, tasks, t => ({ ...t, [`task:${id}`]: 'pending' as const }))
    return ran
  })
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && e.status) {
      const k = `task:${e.taskId}`
      const status = e.status
      await update($, tasks, t => {
        const copy = { ...t }
        if (status === 'deleted') delete copy[k]
        else copy[k] = status
        return copy
      })
    }
    return ran
  })
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const todos = e.todos
      await update($, tasks, t => ({
        ...Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('todo:'))),
        ...Object.fromEntries(todos.map((td, n) => [`todo:${n}`, td.status])),
      }))
    }
    return ran
  })
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = next(e)
    $.clock.after(1500, () => void refreshAgents($))
    const result = await ran
    await refreshAgents($)
    return result
  })

  // Under the prompt: the engine's hint line, then the colored lines.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const d = await statusData($)
    const hint = await next(e)
    const lines = statusSegs(d, { columns: e.viewport?.columns, isDraft: e.props.isDraft })
    return (
      <Box flexDirection="column">
        {hint}
        {lines.map(line => (
          <Text wrap="truncate-end">
            {line.map(seg => (
              <Text color={seg.color} weight={seg.bold ? 'bold' : undefined}>{seg.text}</Text>
            ))}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = sortLimits(await read($, limits))
    const at = await read($, readAt)
    const saved = await read($, isSaved)
    const i = await read($, info)
    const nowMs = (await read($, now)) || Date.now()
    const cols = e.props?.bodyColumns ?? 40
    const width = Math.max(10, Math.min(40, cols - 2))

    const row = (icon: string, label: string, value: string | undefined, color?: string) => (
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text>
          <Text dimColor>{`${icon} `}</Text>
          <Text dimColor>{label}</Text>
        </Text>
        <Text color={color} weight="bold">{value ?? '–'}</Text>
      </Box>
    )

    const gitValue =
      i.branch === undefined
        ? undefined
        : `${i.branch}${i.staged ? ` +${i.staged}` : ''}${i.modified ? ` ~${i.modified}` : ''}`

    return (
      <Box flexDirection="column" gap={1}>
        {list.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor>Sem leitura de uso ainda.</Text>
            <Text dimColor>Aparece depois da primeira resposta do Claude.</Text>
          </Box>
        ) : (
          list.map(limit => {
            const pct = Math.round(limit.percentUsed)
            const resetMs = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
            const hasReset = Number.isFinite(resetMs)
            const passed = hasReset && resetMs <= nowMs
            return (
              <Box flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between" width={width}>
                  <Text>
                    <Text dimColor>{`${ICONS[limit.kind] ?? '◇'} `}</Text>
                    <Text weight="bold">{labelOf(limit.kind)}</Text>
                  </Text>
                  <Text color={tone(pct)} weight="bold" tabular>{`${pct}%`}</Text>
                </Box>
                <Text color={tone(pct)}>{bar(pct, width)}</Text>
                {hasReset ? (
                  passed ? (
                    <Text dimColor>reiniciado, aguardando nova leitura</Text>
                  ) : (
                    <Text>
                      <Text dimColor>{`${ICON.ends} `}</Text>
                      {`termina ${resetLabel(resetMs, nowMs)}`}
                      <Text dimColor>{`  (${countdown(resetMs, nowMs)})`}</Text>
                    </Text>
                  )
                ) : (
                  <Text dimColor>sem horário de término</Text>
                )}
              </Box>
            )
          })
        )}

        {at > 0 && (
          <Text dimColor>
            {`${ICON.fresh} `}
            {saved ? `leitura da sessão anterior, ${age(at, nowMs)}` : `atualizado ${age(at, nowMs)}`}
          </Text>
        )}

        <Box flexDirection="column">
          {row(ICON.model, 'Modelo', i.model)}
          {row(ICON.effort, 'Esforço', i.effort)}
          {row(ICON.context, 'Contexto', i.contextPct === undefined ? undefined : `${i.contextPct}%`, i.contextPct === undefined ? undefined : ctxTone(i.contextPct))}
          {row(ICON.cost, 'Custo da sessão', i.costUsd === undefined ? undefined : `$${i.costUsd.toFixed(2)}`)}
          {row(ICON.dir, 'Pasta', i.dir)}
          {row(ICON.git, 'Git', gitValue ?? 'sem repositório')}
        </Box>
      </Box>
    )
  })
}
