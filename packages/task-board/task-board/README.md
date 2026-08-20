# @deepseek-ai/dsh-task-board

English | [中文](README.zh.md)

This Host package owns durable task cards, the five-state workflow, execution-round summaries, Storage Domain persistence, the provider-neutral `taskBoardSession` service, and the generated `taskBoard` Remote namespace.

## Config

```yaml
- name: '@deepseek-ai/dsh-task-board'
  config:
    automaticTitleMaxChars: 80
    maxTitleBytes: 4096
    maxDescriptionBytes: 65536
    maxAcceptanceCriteriaBytes: 65536
    maxFeedbackBytes: 32768
```

All values are required positive safe integers. Automatic titles use Unicode code-point limits; request text uses UTF-8 byte limits and fails before persistence or Session admission.

## Workflow

Cards use `initialized`, `running`, `review`, `done`, and `failed`. Starting an initialized card creates a fresh Session with the deployment default Agent Preset. A completed turn enters `review`; approval enters `done`; rejection requires non-blank feedback and starts a revision round in the same Session. Retry always starts a fresh Session. Stop cancels the active turn and records a failed or cancelled terminal round before the card leaves `running`.

Each task keeps one append-only round list. A round records its Session id, prompt correlation, timing, terminal status, optional feedback, and a user-safe failure summary. Full conversation and tool history stay in the linked Session.

## Persistence and synchronization

Storage Domain form `task_board` stores one board metadata record and one record per task. The board revision increases for every committed mutation; each task also carries a compare-and-set revision. Stale mutations return `revision-conflict` with the current task instead of overwriting it.

The Remote namespace exposes `snapshot`, `create`, `edit`, `reorder`, `start`, `stop`, `approve`, `reject`, `retry`, `reopen`, and `delete`. `task-board/changed` is emitted only after persistence succeeds. Clients repair an event revision gap with an authoritative snapshot.

## Session admission

`TaskBoardSessionService` defines create, prompt, and cancel without depending on one transport. The Web profile uses [`@deepseek-ai/dsh-task-board-session-apiproxy`](../session-apiproxy/README.md), which mounts the provider and this service behind one Loader entry.

## Model Experience

### Task execution messages

#### What the model sees

Task Board adds no system-prompt text or model tools. `TaskBoardSessionService` admits initial requirements, acceptance criteria, rejection feedback, and retry instructions through ordinary Session user messages, so the Session log reconstructs every model-visible input.

#### Token effect

Board reads, search, ordering, editing, review approval, and Session navigation consume no model tokens. Starting, rejecting, or retrying creates one ordinary user turn and its resulting model usage.

#### KV Cache effect

Rejection continues the current Session and can reuse its provider cache according to the selected model provider. Initial starts and retries create fresh Sessions and do not inherit a previous task round's conversation cache.

## Known Limitations and Deferred Work

- Task Board has no scheduler or autonomous retry loop; a user explicitly starts or retries each task.
- One task can own only one active round, and a running task cannot be edited or deleted.
- Round records are summaries, not transcript copies; inspect the linked Session for complete execution details.
