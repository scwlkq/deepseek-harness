# 任务面板

[English](task-board.md) | 中文

Task Board 在普通 Harness Session 之上增加持久且需审核的工作项，Session 仍是模型可见执行的权威来源。[包家族](../../packages/task-board/README.md)分别负责 Host 工作流、单入口 ApiProxy 组合和 [Client 界面](../../packages/client/ui-task-board/README.md)。

## 权威来源

Storage Domain form `task_board` 负责任务卡身份、状态、同列排序、执行轮次、完成时间和 Session 链接。Session 日志负责每个已接收提示、模型响应、工具事件和终止结果。轮次记录只汇总 Session 执行，不复制对话。

`@deepseek-ai/dsh-task-board` 负责变更和生成的 Remote 方法。每次任务变更都携带 `{ id, revision }`；过期版本返回当前任务，不会覆盖新状态。只有看板版本和任务记录都提交后才会发布 `task-board/changed`。

## 工作流

任务卡使用 `initialized`、`running`、`review`、`done` 和 `failed`。Session 成功执行会把 `running` 变为 `review`；只有显式通过才能把 `review` 变为 `done`。驳回必须填写反馈，并在同一 Session 中启动修订轮次。失败会保持 `failed`，直到用户显式重试；重试会创建一个新 Session 轮次。

拖拽只调整当前状态列内的顺序。启动、停止、通过、驳回、重试、重新打开和删除仍是显式 Host 变更，因为这些操作包含排序无法授权的生命周期或持久化效果。

## Session 编排

`TaskBoardSessionService` 由 `@deepseek-ai/dsh-task-board` 定义，覆盖任务自有 Session 的创建、提示接入和取消，不绑定具体传输。`@deepseek-ai/dsh-task-board-session-apiproxy` 通过普通 Host ApiProxy 方法提供该服务，并在一个 Web Loader 条目中挂载 Task Board。

Host 在提示接入前持久化启动中轮次，通过 RPC id 关联已接收的用户消息，并依据 Session 事件对账终止结果。驳回会延续最新 Session；首次启动和重试会创建新 Session。逐任务变更队列会阻止轮次重叠。

## 持久化与 Remote 投影

生成的 `taskBoard` 命名空间提供 `snapshot`、`create`、`edit`、`reorder`、`start`、`stop`、`approve`、`reject`、`retry`、`reopen` 和 `delete`。传输失败与稳定业务拒绝保持可区分。

Client 把 `snapshot()` 视为权威来源，只应用连续的 `task-board/changed` 版本，并在版本缺口或连接重置后刷新。版本冲突会用 Host 当前值替换过期本地任务。

## Web 界面

`@deepseek-ai/dsh-client-ui-task-board` 通过 Client slot 注册侧边栏入口和全屏浮层。它提供五个固定工作流列、保留字段搜索、同列排序、任务创建、可编辑详情、工作流操作、精简轮次摘要和完整 Harness Session 链接。

## 边界与限制

- 任务数据不会作为隐藏模型上下文注入；初始需求、验收标准、驳回反馈和重试说明使用普通 Session 提示。
- 模型成功完成一轮后会进入人工审核，不代表已经通过。
- 失败任务不会自动重试。
- 跨列拖拽不会改变工作流状态。
- 新 Session 重试会保留任务字段，但不会保留此前 Session 对话。
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
