# Task Board

English | [中文](task-board.zh.md)

Task Board adds durable reviewed work items while ordinary Harness Sessions remain authoritative for model-visible execution. The [package family](../../packages/task-board/README.md) separates Host workflow ownership, one ApiProxy composition, and the [Client surface](../../packages/client/ui-task-board/README.md).

## Authorities

Storage Domain form `task_board` owns card identity, task status, same-column ordering, execution rounds, completion time, and Session links. Session logs own every admitted prompt, model response, tool event, and terminal outcome. Round records summarize Session execution without copying its transcript.

`@deepseek-ai/dsh-task-board` owns mutations and generated Remote methods. Every task mutation carries `{ id, revision }`; a stale revision returns the current task instead of overwriting it. `task-board/changed` is published only after the board revision and task record commit.

## Workflow

Cards use `initialized`, `running`, `review`, `done`, and `failed`. Successful Session execution changes `running` to `review`; only explicit approval changes `review` to `done`. Rejection requires feedback and starts a revision round in the same Session. Failure remains `failed` until explicit retry, and retry starts one fresh-Session round.

Dragging changes order only within the current status column. Start, stop, approve, reject, retry, reopen, and delete remain explicit Host mutations because they carry lifecycle or persistence effects that ordering cannot authorize.

## Session orchestration

`TaskBoardSessionService` is defined by `@deepseek-ai/dsh-task-board` and covers board-owned Session creation, prompt admission, and cancellation without choosing a transport. `@deepseek-ai/dsh-task-board-session-apiproxy` provides that service through ordinary Host ApiProxy methods and mounts Task Board behind one Web Loader entry.

The Host persists a starting round before prompt admission, correlates the accepted user message by RPC id, and reconciles the terminal result from Session events. Rejection continues the latest Session; initial start and retry create new Sessions. Per-task mutation queues prevent overlapping rounds.

## Persistence and Remote projection

The generated `taskBoard` namespace exposes `snapshot`, `create`, `edit`, `reorder`, `start`, `stop`, `approve`, `reject`, `retry`, `reopen`, and `delete`. Transport failures and stable business rejections remain distinct.

Clients treat `snapshot()` as authoritative, apply only contiguous `task-board/changed` revisions, and refresh after a revision gap or connection reset. A revision conflict replaces the stale local card with the Host value.

## Web surface

`@deepseek-ai/dsh-client-ui-task-board` registers a sidebar launcher and full-frame overlay through Client slots. It provides five fixed workflow columns, retained-field search, same-column ordering, creation, editable details, workflow actions, compact round summaries, and links to complete Harness Sessions.

## Boundaries and limitations

- Task data is not injected as hidden model context; initial requirements, acceptance criteria, rejection feedback, and retry instructions use ordinary Session prompts.
- A successful model turn enters human review and never implies approval.
- Failed work never retries automatically.
- Cross-column dragging never changes workflow state.
- A fresh retry preserves retained task fields but does not preserve the previous Session conversation.
<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskboard--taskboardservice"></a>

### `ctx.taskBoard` — `TaskBoardService`

Storage authority and generated `taskBoard` Remote methods.

```ts cordis-catalog
/**
 * Read the board after all previously admitted commits.
 * @returns Immutable board snapshot and global revision.
 */
@Remote('snapshot') snapshot(): Promise<TaskBoardSnapshotResult>

/**
 * Create one durable initialized card and optionally start it.
 * @param request - Validated task content and start intent.
 * @returns Committed task or a stable request failure.
 */
@Remote('create') async create(request: TaskBoardCreateRequest): Promise<TaskBoardTaskResult>

/**
 * Edit retained task fields after a compare-and-set revision check.
 * @param ref - Task identity and observed revision.
 * @param patch - Replacement fields and optional cwd clearing.
 * @returns Committed task, current conflict value, or stable rejection.
 */
@Remote('edit') edit(ref: TaskBoardTaskRef, patch: TaskBoardEditPatch): Promise<TaskBoardTaskResult>

/**
 * Move a card before another card in the same workflow state.
 * @param ref - Task identity and observed revision.
 * @param request - Optional same-column anchor; omission appends.
 * @returns Committed moved task or stable rejection.
 */
@Remote('reorder') reorder( ref: TaskBoardTaskRef, request: TaskBoardReorderRequest, ): Promise<TaskBoardTaskResult>

/**
 * Start an initialized card in a fresh Harness Session.
 * @param ref - Task identity and observed revision.
 * @returns Task after prompt admission or a stable rejection.
 */
@Remote('start') start(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>

/**
 * Submit review feedback in the current Session.
 * @param ref - Reviewed task identity and observed revision.
 * @param request - Required rejection feedback.
 * @returns Task after feedback admission or a stable rejection.
 */
@Remote('reject') reject( ref: TaskBoardTaskRef, request: TaskBoardRejectRequest, ): Promise<TaskBoardTaskResult>

/**
 * Retry a failed task in a fresh Harness Session.
 * @param ref - Failed task identity and observed revision.
 * @returns Task after retry prompt admission or a stable rejection.
 */
@Remote('retry') retry(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>

/**
 * Stop the active Session turn and mark the task failed.
 * @param ref - Running task identity and observed revision.
 * @returns Stopped task or stable Session rejection.
 */
@Remote('stop') stop(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>

/**
 * Mark a successfully executed reviewed task complete.
 * @param ref - Reviewed task identity and observed revision.
 * @returns Completed task or stable rejection.
 */
@Remote('approve') approve(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>

/**
 * Reopen an approved card while retaining round summaries.
 * @param ref - Completed task identity and observed revision.
 * @returns Initialized task or stable rejection.
 */
@Remote('reopen') reopen(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>

/**
 * Delete one card after workflow confirmation rules.
 * @param ref - Task identity and observed revision.
 * @returns Durable deletion acknowledgement or stable rejection.
 */
@Remote('delete') delete(ref: TaskBoardTaskRef): Promise<TaskBoardDeleteResult>

/**
 * Read one task from synchronously committed domain memory.
 * @param id - Stable task identity.
 * @returns Detached immutable task or `undefined` when absent.
 */
getTask(id: TaskBoardTaskId): TaskBoardTask | undefined

/**
 * Read committed tasks for package-owned invariant checks.
 * @returns Detached immutable tasks in storage iteration order.
 */
inspectTasks(): readonly TaskBoardTask[]

/**
 * Read the global revision used to validate emitted board changes.
 * @returns Current committed global board revision.
 */
currentBoardRevision(): number

/**
 * Wait for every task-board operation admitted before this call.
 * @param _id - Task identity retained for the package test contract.
 * @returns Resolution after the current serial mutation tail settles.
 */
async whenSettled(_id: TaskBoardTaskId): Promise<void>
```

Source: [`packages/task-board/task-board/src/index.ts:145`](../../packages/task-board/task-board/src/index.ts)

<a id="ctxtaskboardsession--taskboardsessionservice-abstract-seam"></a>

### `ctx.taskBoardSession` — `TaskBoardSessionService` (abstract seam)

Provider-neutral Session operations required by Task Board.

```ts cordis-catalog
/**
 * Create one Session using the deployment's default Agent Preset.
 * @param request - reserved identity and optional working directory.
 * @returns Session creation result.
 */
abstract create( request: CreateTaskSessionRequest, ): Promise<TaskBoardSessionResult<{ readonly sessionId: SessionId }>>

/**
 * Queue one ordinary user prompt in a board-owned Session.
 * @param request - Session identity, correlation identity and text.
 * @returns prompt admission result.
 */
abstract prompt( request: PromptTaskSessionRequest, ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>>

/**
 * Cancel the active turn of a board-owned Session.
 * @param request - Session and correlation identities.
 * @returns cancellation admission result.
 */
abstract cancel( request: TaskBoardSessionRequest, ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>>
```

Types: [SessionId](core.md)

Source: [`packages/task-board/task-board/src/session.ts:36`](../../packages/task-board/task-board/src/session.ts)

<a id="task-board-events"></a>

### `task-board/*` events

<a id="task-boardchanged--emit"></a>

#### `task-board/changed` — emit

Publishes one fully committed task-board mutation.

```ts cordis-catalog
/**
 * Publishes one fully committed task-board mutation.
 * @param change - Authoritative task projection or deletion tombstone.
 * @mode emit
 */
'task-board/changed'(change: TaskBoardChange): void
```

Source: [`packages/task-board/task-board/src/types.ts:246`](../../packages/task-board/task-board/src/types.ts)
<!-- END GENERATED cordis-surface -->
