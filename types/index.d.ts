/** One rate-limit window as last reported: kind, percent used, reset time (ISO). */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The rest of what the status line shows. Every field may be missing. */
export type Info = {
  model?: string
  effort?: string
  contextPct?: number
  costUsd?: number
  dir?: string
  branch?: string
  staged?: number
  modified?: number
}

/** The Jira issue tied to this session, as last fetched. */
export type JiraIssue = {
  key: string
  summary?: string
  status?: string
  /** Jira's status category: "Itens Pendentes", "Em andamento", "Concluído"... */
  category?: string
  assignee?: string
  priority?: string
  url?: string
  /** When it was fetched (ms); 0 while loading. */
  fetchedAt: number
  /** Why the last fetch failed, when it did. */
  error?: string
  /** Where the key came from. */
  source: 'branch' | 'manual'
}

/** A task's state as the model last set it. */
export type TaskState = 'pending' | 'in_progress' | 'completed'

/** What `/uso config` turns on and off under the prompt. */
export type Config = {
  /** When the limit runs out at the current pace. */
  ritmo: boolean
  /** A warning when the context nears compaction. */
  contexto: boolean
  /** The line of live agents and open tasks. */
  atividade: boolean
  /** Session length and cost per hour. */
  tempo: boolean
  /** One line while the prompt holds a draft. */
  compacto: boolean
  /** Separators aligned in shared columns. */
  alinhar: boolean
  /** The Jira issue of the branch or of /uso jira. */
  jira: boolean
  /** The small BSN logo beside the lines. */
  logo: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'uso-monitor': {
      limits: Shaped<Limit[]>
      /** When `limits` was read (ms since epoch); 0 when never. */
      readAt: Shaped<number>
      /** True when `limits` came from an earlier session's saved reading. */
      isSaved: Shaped<boolean>
      info: Shaped<Info>
      /** Last clock tick (ms); only here so the countdowns redraw. */
      now: Shaped<number>
      /** When the session started (ms); 0 when unknown. */
      startedAt: Shaped<number>
      /** Agents pending, running or waiting. */
      agents: Shaped<number>
      /** Tasks by `task:<id>` or `todo:<index>`. */
      tasks: Shaped<Record<string, TaskState>>
      /** The person's toggles; missing keys take the defaults. */
      config: Shaped<Partial<Config>>
      /** The issue shown; null when none. */
      jira: Shaped<JiraIssue | null>
      /** A key pinned with /uso jira; '' when none (the branch decides). */
      jiraPin: Shaped<string>
    }
  }
}
