# uso-monitor

Mod para o Claude Code que mostra, logo abaixo da caixa de digitação, o uso da sessão e da semana, em tons de azul:

```
◆ opus-5-5  │  ≡ medium      │  ◧ 63%  │  ◎ $1.50
◷ 5h ███░░░░░░░ 30%  ↻ 13:00 · ritmo ok  │  ▦ 7d ██████░░░░ 62%  ↻ sáb 14:00 · ▲ esgota amanhã 13:32
⌂ projeto   │  ⎇ main +1 ~2  │  ◴ 1h 12min · $1.25/h
⚙ 2 agentes  │  ☐ 2 tarefas (1 em andamento)
```

- Barras de uso de 5h e 7d em verde, amarelo e vermelho, com horário de reinício
- Previsão de ritmo: avisa se o limite vai acabar antes de reiniciar
- Aviso quando o contexto passa de 80%
- Agentes e tarefas ativos, duração da sessão e custo por hora
- Linha única enquanto você digita ou em terminal estreito
- Avisos em 80% e 90% de uso
- `/uso` abre o painel completo; `/uso config` liga e desliga cada item

## Jira e logo (0.6.0)

- **Tarefa do Jira, sem comando:** aparece sozinha. A escolha segue esta ordem: tarefa fixada com
  `/uso jira CARPA-127` (vale para a pasta e fica salva) → chave do branch (`feature/CARPA-127-esteira`) → última
  chave dos seus projetos citada no chat → sua tarefa em andamento mais recente, preferindo as que estão sendo
  desenvolvidas às que aguardam merge ou homologação. O painel `/uso` lista todas as suas em andamento. A linha mostra chave, título, status, responsável e
  prioridade; o painel `/uso` traz o link. Usa o plugin `atlassian` já conectado no Claude Code, sem token próprio.
  Atualiza a cada 10 min; `/uso jira atualizar` força, `/uso jira off` desfixa, `/uso config jira off` esconde.
- **Logo da BSN:** desenhada com caracteres de bloco, como as barras de uso, em verde-limão, à esquerda das linhas
  (25 colunas × 3 linhas). Funciona em qualquer terminal, inclusive o do VS Code. Enquanto você digita (linha
  compacta) vira só `BSN`; em telas com menos de ~87 colunas some. `/uso config logo off` esconde.

## Instalar

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install uso-monitor --marketplace eupivotto/uso-monitor
```

Responda `y` para adicionar o marketplace e escolha o escopo (user, o primeiro, vale para todas as sessões).

Pelo shell:

```
claude plugin install uso-monitor --marketplace eupivotto/uso-monitor
```

No app desktop, onde `/plugin` não roda: clique em + ao lado da caixa de digitação, depois Plugins, Add marketplace com `eupivotto/uso-monitor`, e então Add plugin.

## Desenvolver

Clone o repositório e carregue o Claude Code a partir da pasta:

```
git clone https://github.com/eupivotto/uso-monitor.git
claude --plugin-dir ./uso-monitor
```

Para carregar sempre, adicione a pasta em `env.CLAUDE_CODE_PLUGIN_DIRS` no `~/.claude/settings.json`.

Checagens:

```
claude plugin validate .
claude plugin test .
```
