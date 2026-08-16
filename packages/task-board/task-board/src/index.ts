/** Durable reviewed task cards with Harness Session orchestration. @module @deepseek-ai/dsh-task-board */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import {
  SessionId,
  type SessionEvent,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import s from '@deepseek-ai/schemastery'
import type {} from './session.ts'
import {
  taskBoardDomainSpec,
} from './spec.ts'
import type { TaskBoardGlobal } from './spec.ts'
import {
  approveTaskRecord,
  composeInitialPrompt,
  createTaskRecord,
  deleteAllowed,
  editTaskRecord,
  failRoundAdmissionRecord,
  markRoundRunningRecord,
  projectRoundOutcome,
  reconcileRound,
  recordRoundEvidence,
  rejectTaskRecord,
  requestStopRecord,
  reopenTaskRecord,
  reorderTaskRecord,
  retryTaskRecord,
  snapshotBoard,
  snapshotTask,
  startRoundRecord,
  TaskBoardStateError,
} from './state.ts'
import type {
  TaskBoardRoundEvidence,
  TaskBoardRoundProjection,
} from './state.ts'
import type {
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardDeleteResult,
  TaskBoardDeleteValue,
  TaskBoardEditPatch,
  TaskBoardFailure,
  TaskBoardFailureResult,
  TaskBoardRejectRequest,
  TaskBoardRejected,
  TaskBoardReorderRequest,
  TaskBoardResult,
  TaskBoardRoundId,
  TaskBoardRpcId,
  TaskBoardSnapshotResult,
  TaskBoardSuccess,
  TaskBoardTask,
  TaskBoardTaskId,
  TaskBoardTaskRef,
  TaskBoardTaskResult,
} from './types.ts'

export type * from './types.ts'
export {
  TaskBoardSessionService,
} from './session.ts'
export type {
  CreateTaskSessionRequest,
  PromptTaskSessionRequest,
  TaskBoardSessionRequest,
  TaskBoardSessionResult,
} from './session.ts'
export {
  taskBoardDomainSpec,
  taskBoardFailureSchema,
  taskBoardGlobalSchema,
  taskBoardRoundSchema,
  taskBoardTaskSchema,
} from './spec.ts'
export type { TaskBoardGlobal } from './spec.ts'

/** Deployment-varying limits for task-board user text. */
export interface Config {
  /** Maximum Unicode code points retained in an automatic title. */
  readonly automaticTitleMaxChars: number
  /** Maximum UTF-8 byte length accepted for a manual title. */
  readonly maxTitleBytes: number
  /** Maximum UTF-8 byte length accepted for task description. */
  readonly maxDescriptionBytes: number
  /** Maximum UTF-8 byte length accepted for acceptance criteria. */
  readonly maxAcceptanceCriteriaBytes: number
  /** Maximum UTF-8 byte length accepted for rejection feedback. */
  readonly maxFeedbackBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskBoard: TaskBoardService
  }
}

function success<T>(value: T): TaskBoardSuccess<T> {
  return { ok: true, value }
}

function rejected(error: TaskBoardFailureResult): TaskBoardRejected {
  return { ok: false, error }
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`task-board: ${name} must be a positive safe integer, got ${String(value)}`)
  }
  return value
}

function taskId(): TaskBoardTaskId {
  return randomUUID() as TaskBoardTaskId
}

function roundId(): TaskBoardRoundId {
  return randomUUID() as TaskBoardRoundId
}

function rpcId(): TaskBoardRpcId {
  return randomUUID() as TaskBoardRpcId
}

function sessionId(): SessionId {
  return SessionId(`task-board-${randomUUID()}`)
}

function initialPosition(sequence: number): string {
  const value = sequence * 1_000_000
  if (!Number.isSafeInteger(value)) throw new Error('task-board: sequence exceeds the ordering range')
  return String(value).padStart(16, '0')
}

/** Storage authority and generated `taskBoard` Remote methods. */
export class TaskBoardService extends TypertRemoteService {
  static inject = [
    'agents',
    'sessionPersistence',
    'sessions',
    'storageDomain',
    'taskBoardSession',
  ]

  /** Loader-configurable text limits. */
  static Config: s<Config> = s.object({
    automaticTitleMaxChars: s.number().step(1).min(1).required(),
    maxTitleBytes: s.number().step(1).min(1).required(),
    maxDescriptionBytes: s.number().step(1).min(1).required(),
    maxAcceptanceCriteriaBytes: s.number().step(1).min(1).required(),
    maxFeedbackBytes: s.number().step(1).min(1).required(),
  })

  private readonly config: Config
  private global?: DomainGlobal<TaskBoardGlobal>
  private tasks?: KvTable<TaskBoardTaskId, TaskBoardTask>
  private mutationTail: Promise<void> = Promise.resolve()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying persistence and Session services.
   * @param config - User-text limits.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'taskBoard')
    this.config = {
      automaticTitleMaxChars: positiveSafeInteger('automaticTitleMaxChars', config.automaticTitleMaxChars),
      maxTitleBytes: positiveSafeInteger('maxTitleBytes', config.maxTitleBytes),
      maxDescriptionBytes: positiveSafeInteger('maxDescriptionBytes', config.maxDescriptionBytes),
      maxAcceptanceCriteriaBytes: positiveSafeInteger(
        'maxAcceptanceCriteriaBytes',
        config.maxAcceptanceCriteriaBytes,
      ),
      maxFeedbackBytes: positiveSafeInteger('maxFeedbackBytes', config.maxFeedbackBytes),
    }
  }

  /** Open and own the task-board Storage Domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(taskBoardDomainSpec)
    this.global = domain.global
    this.tasks = domain.table('tasks')
    this.ctx.on('session/event', (session) => {
      this.scheduleReconcile(session.id)
    }, { global: true })
    this.ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.scheduleReconcile(agent.id)
    }, { global: true })
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await this.mutationTail
      await domain.close()
    }, 'task-board.domainClose')
    for (const [, task] of this.requireTasks().entries()) {
      if (task.status === 'running') this.scheduleReconcile(this.currentSessionId(task))
    }
  }

  /**
   * Read the board after all previously admitted commits.
   * @returns Immutable board snapshot and global revision.
   */
  @Remote('snapshot') snapshot(): Promise<TaskBoardSnapshotResult> {
    return this.enqueueMutation(() => Promise.resolve(success(snapshotBoard(
      [...this.requireTasks().entries()].map(([, task]) => task),
      this.requireGlobal().get().boardRevision,
    ))))
  }

  /**
   * Create one durable initialized card and optionally start it.
   * @param request - Validated task content and start intent.
   * @returns Committed task or a stable request failure.
   */
  @Remote('create') async create(request: TaskBoardCreateRequest): Promise<TaskBoardTaskResult> {
    const invalid = this.validateCreate(request)
    if (invalid !== undefined) return invalid
    const created = await this.enqueueMutation(async () => {
      const currentGlobal = this.requireGlobal().get()
      const task = createTaskRecord(request, {
        id: taskId(),
        sequence: currentGlobal.nextSequence,
        position: initialPosition(currentGlobal.nextSequence),
        now: Date.now(),
        automaticTitleMaxChars: this.config.automaticTitleMaxChars,
      })
      const boardRevision = currentGlobal.boardRevision + 1
      await this.requireGlobal().set({
        nextSequence: currentGlobal.nextSequence + 1,
        boardRevision,
      })
      await this.requireTasks().put(task.id, task)
      this.emitChange({ boardRevision, operation: 'created', taskId: task.id, task })
      return success(snapshotTask(task))
    })
    if (!request.start) return created
    return this.start({ id: created.value.id, revision: created.value.revision })
  }

  /**
   * Edit retained task fields after a compare-and-set revision check.
   * @param ref - Task identity and observed revision.
   * @param patch - Replacement fields and optional cwd clearing.
   * @returns Committed task, current conflict value, or stable rejection.
   */
  @Remote('edit') edit(ref: TaskBoardTaskRef, patch: TaskBoardEditPatch): Promise<TaskBoardTaskResult> {
    const invalid = this.validateEditPatch(patch)
    if (invalid !== undefined) return Promise.resolve(invalid)
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      let next: TaskBoardTask
      try {
        next = editTaskRecord(current.value, patch, { now: Date.now() })
      } catch (error) {
        return this.stateRejection(current.value, 'edit', error)
      }
      if (next === current.value) return success(snapshotTask(current.value))
      return success(await this.commitTask(next, 'updated'))
    })
  }

  /**
   * Move a card before another card in the same workflow state.
   * @param ref - Task identity and observed revision.
   * @param request - Optional same-column anchor; omission appends.
   * @returns Committed moved task or stable rejection.
   */
  @Remote('reorder') reorder(
    ref: TaskBoardTaskRef,
    request: TaskBoardReorderRequest,
  ): Promise<TaskBoardTaskResult> {
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      const siblings = [...this.requireTasks().entries()]
        .map(([, task]) => task)
        .filter(task => task.status === current.value.status)
      let result
      try {
        result = reorderTaskRecord(current.value, siblings, request, { now: Date.now() })
      } catch (error) {
        if (!(error instanceof TaskBoardStateError)) throw error
        return this.invalidRequest('beforeTaskId', error.message)
      }
      for (const changed of result.changed) await this.commitTask(changed, 'updated')
      return success(snapshotTask(this.requireTask(ref.id)))
    })
  }

  /**
   * Start an initialized card in a fresh Harness Session.
   * @param ref - Task identity and observed revision.
   * @returns Task after prompt admission or a stable rejection.
   */
  @Remote('start') start(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      const nextSessionId = sessionId()
      const promptRpcId = rpcId()
      let starting: TaskBoardTask
      try {
        starting = startRoundRecord(current.value, {
          roundId: roundId(),
          sessionId: nextSessionId,
          rpcId: promptRpcId,
          trigger: 'initial',
          prompt: composeInitialPrompt(current.value),
          now: Date.now(),
        })
      } catch (error) {
        return this.stateRejection(current.value, 'start', error)
      }
      await this.commitTask(starting, 'updated')
      return this.admitPreparedRound(starting.id, true)
    })
  }

  /**
   * Submit review feedback in the current Session.
   * @param ref - Reviewed task identity and observed revision.
   * @param request - Required rejection feedback.
   * @returns Task after feedback admission or a stable rejection.
   */
  @Remote('reject') reject(
    ref: TaskBoardTaskRef,
    request: TaskBoardRejectRequest,
  ): Promise<TaskBoardTaskResult> {
    const invalid = this.validateText('feedback', request.feedback, this.config.maxFeedbackBytes, false)
    if (invalid !== undefined) return Promise.resolve(invalid)
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      let starting: TaskBoardTask
      try {
        starting = rejectTaskRecord(current.value, {
          feedback: request.feedback,
          roundId: roundId(),
          rpcId: rpcId(),
          now: Date.now(),
        })
      } catch (error) {
        return this.stateRejection(current.value, 'reject', error)
      }
      await this.commitTask(starting, 'updated')
      return this.admitPreparedRound(starting.id, false)
    })
  }

  /**
   * Retry a failed task in a fresh Harness Session.
   * @param ref - Failed task identity and observed revision.
   * @returns Task after retry prompt admission or a stable rejection.
   */
  @Remote('retry') retry(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      let starting: TaskBoardTask
      try {
        starting = retryTaskRecord(current.value, {
          sessionId: sessionId(),
          roundId: roundId(),
          rpcId: rpcId(),
          now: Date.now(),
        })
      } catch (error) {
        return this.stateRejection(current.value, 'retry', error)
      }
      await this.commitTask(starting, 'updated')
      return this.admitPreparedRound(starting.id, true)
    })
  }

  /**
   * Stop the active Session turn and mark the task failed.
   * @param ref - Running task identity and observed revision.
   * @returns Stopped task or stable Session rejection.
   */
  @Remote('stop') stop(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      if (current.value.status !== 'running') {
        return rejected({ code: 'invalid-transition', status: current.value.status, operation: 'stop' })
      }
      const currentSessionId = this.currentSessionId(current.value)
      const response = await this.ctx.taskBoardSession.cancel({
        requestId: rpcId(),
        sessionId: currentSessionId,
      })
      if (!response.ok) return rejected({ code: 'session-unavailable', sessionId: currentSessionId })
      const stopped = requestStopRecord(this.requireTask(ref.id), { now: Date.now() })
      return success(await this.commitTask(stopped, 'updated'))
    })
  }

  /**
   * Mark a successfully executed reviewed task complete.
   * @param ref - Reviewed task identity and observed revision.
   * @returns Completed task or stable rejection.
   */
  @Remote('approve') approve(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.mutateOne(ref, 'approve', task => approveTaskRecord(task, { now: Date.now() }))
  }

  /**
   * Reopen an approved card while retaining round summaries.
   * @param ref - Completed task identity and observed revision.
   * @returns Initialized task or stable rejection.
   */
  @Remote('reopen') reopen(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.mutateOne(ref, 'reopen', task => reopenTaskRecord(task, { now: Date.now() }))
  }

  /**
   * Delete one card after workflow confirmation rules.
   * @param ref - Task identity and observed revision.
   * @returns Durable deletion acknowledgement or stable rejection.
   */
  @Remote('delete') delete(ref: TaskBoardTaskRef): Promise<TaskBoardDeleteResult> {
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      if (!deleteAllowed(current.value, true)) {
        return rejected({ code: 'invalid-transition', status: current.value.status, operation: 'delete' })
      }
      const global = this.requireGlobal().get()
      const boardRevision = global.boardRevision + 1
      await this.requireGlobal().set({ ...global, boardRevision })
      const deleted = await this.requireTasks().delete(ref.id)
      if (!deleted) throw new Error(`task-board: committed task '${ref.id}' disappeared before deletion`)
      this.emitChange({ boardRevision, operation: 'deleted', taskId: ref.id })
      return success<TaskBoardDeleteValue>({ deleted: true, taskId: ref.id })
    })
  }

  /**
   * Read one task from synchronously committed domain memory.
   * @param id - Stable task identity.
   * @returns Detached immutable task or `undefined` when absent.
   */
  getTask(id: TaskBoardTaskId): TaskBoardTask | undefined {
    const task = this.requireTasks().get(id)
    return task === undefined ? undefined : snapshotTask(task)
  }

  /**
   * Read committed tasks for package-owned invariant checks.
   * @returns Detached immutable tasks in storage iteration order.
   */
  inspectTasks(): readonly TaskBoardTask[] {
    return [...this.requireTasks().entries()].map(([, task]) => snapshotTask(task))
  }

  /**
   * Read the global revision used to validate emitted board changes.
   * @returns Current committed global board revision.
   */
  currentBoardRevision(): number {
    return this.requireGlobal().get().boardRevision
  }

  /**
   * Wait for every task-board operation admitted before this call.
   * @param _id - Task identity retained for the package test contract.
   * @returns Resolution after the current serial mutation tail settles.
   */
  async whenSettled(_id: TaskBoardTaskId): Promise<void> {
    await this.mutationTail
  }

  private validateCreate(request: TaskBoardCreateRequest): TaskBoardRejected | undefined {
    const fields: ReadonlyArray<readonly [string, string, number, boolean]> = [
      ['title', request.title ?? '', this.config.maxTitleBytes, true],
      ['description', request.description, this.config.maxDescriptionBytes, true],
      ['acceptanceCriteria', request.acceptanceCriteria, this.config.maxAcceptanceCriteriaBytes, true],
    ]
    for (const [field, value, maxBytes, allowBlank] of fields) {
      const invalid = this.validateText(field, value, maxBytes, allowBlank)
      if (invalid !== undefined) return invalid
    }
    if (request.description.trim().length === 0 && request.acceptanceCriteria.trim().length === 0) {
      return this.invalidRequest('description', 'description and acceptanceCriteria cannot both be blank')
    }
    if (request.cwd !== undefined && request.cwd.trim().length === 0) {
      return this.invalidRequest('cwd', 'cwd cannot be blank')
    }
    return undefined
  }

  private validateEditPatch(patch: TaskBoardEditPatch): TaskBoardRejected | undefined {
    const fields: ReadonlyArray<readonly [string, string | undefined, number]> = [
      ['title', patch.title, this.config.maxTitleBytes],
      ['description', patch.description, this.config.maxDescriptionBytes],
      ['acceptanceCriteria', patch.acceptanceCriteria, this.config.maxAcceptanceCriteriaBytes],
    ]
    for (const [field, value, maxBytes] of fields) {
      if (value === undefined) continue
      const invalid = this.validateText(field, value, maxBytes, true)
      if (invalid !== undefined) return invalid
    }
    if (typeof patch.cwd === 'string' && patch.cwd.trim().length === 0) {
      return this.invalidRequest('cwd', 'cwd cannot be blank')
    }
    return undefined
  }

  private validateText(
    field: string,
    value: string,
    maxBytes: number,
    allowBlank: boolean,
  ): TaskBoardRejected | undefined {
    if (!allowBlank && value.trim().length === 0) {
      return this.invalidRequest(field, `${field} cannot be blank`)
    }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
      return this.invalidRequest(field, `${field} exceeds ${maxBytes} UTF-8 bytes`)
    }
    return undefined
  }

  private invalidRequest(field: string, message: string): TaskBoardRejected {
    return rejected({ code: 'invalid-request', field, message })
  }

  private resolveRef(ref: TaskBoardTaskRef): TaskBoardResult<TaskBoardTask> {
    const current = this.requireTasks().get(ref.id)
    if (current === undefined) return rejected({ code: 'task-not-found', taskId: ref.id })
    if (current.revision !== ref.revision) {
      return rejected({ code: 'revision-conflict', current: snapshotTask(current) })
    }
    return success(current)
  }

  private mutateOne(
    ref: TaskBoardTaskRef,
    operation: string,
    mutate: (task: TaskBoardTask) => TaskBoardTask,
  ): Promise<TaskBoardTaskResult> {
    return this.enqueueMutation(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      let next: TaskBoardTask
      try {
        next = mutate(current.value)
      } catch (error) {
        return this.stateRejection(current.value, operation, error)
      }
      return success(await this.commitTask(next, 'updated'))
    })
  }

  private async admitPreparedRound(
    id: TaskBoardTaskId,
    createSession: boolean,
  ): Promise<TaskBoardTaskResult> {
    let task = this.requireTask(id)
    const round = task.rounds.at(-1)
    if (round === undefined || round.status !== 'starting') {
      throw new Error(`task-board: task '${id}' has no prepared round`)
    }
    if (createSession) {
      const created = await this.ctx.taskBoardSession.create({
        requestId: rpcId(),
        sessionId: round.sessionId,
        ...(task.cwd === undefined ? {} : { cwd: task.cwd }),
      })
      if (!created.ok) return this.failAdmission(id, created.failure)
    }
    const prompted = await this.ctx.taskBoardSession.prompt({
      requestId: round.rpcId,
      sessionId: round.sessionId,
      text: round.prompt,
    })
    if (!prompted.ok) return this.failAdmission(id, prompted.failure)
    task = this.requireTask(id)
    const running = markRoundRunningRecord(task, { acceptedAt: Date.now() })
    return success(await this.commitTask(running, 'updated'))
  }

  private async failAdmission(
    id: TaskBoardTaskId,
    failure: TaskBoardFailure,
  ): Promise<TaskBoardTaskResult> {
    const failed = failRoundAdmissionRecord(this.requireTask(id), failure, { now: Date.now() })
    await this.commitTask(failed, 'updated')
    return rejected({ code: 'prompt-rejected', failure })
  }

  private stateRejection(
    task: TaskBoardTask,
    operation: string,
    error: unknown,
  ): TaskBoardRejected {
    if (!(error instanceof TaskBoardStateError)) throw error
    return rejected({ code: 'invalid-transition', status: task.status, operation })
  }

  private currentSessionId(task: TaskBoardTask): SessionId {
    const session = task.rounds.at(-1)?.sessionId
    if (session === undefined) throw new Error(`task-board: task '${task.id}' has no Session`)
    return session
  }

  private scheduleReconcile(currentSessionId: SessionId): void {
    if (!this.mutationAdmissionOpen) return
    void this.enqueueMutation(async () => {
      const task = this.findRunningTask(currentSessionId)
      if (task !== undefined) await this.reconcileTaskNow(task.id)
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`task-board: Session reconciliation failed: ${String(error)}`)
    })
  }

  private findRunningTask(currentSessionId: SessionId): TaskBoardTask | undefined {
    for (const [, task] of this.requireTasks().entries()) {
      if (task.status === 'running' && task.rounds.at(-1)?.sessionId === currentSessionId) return task
    }
    return undefined
  }

  private async reconcileTaskNow(id: TaskBoardTaskId): Promise<void> {
    let task = this.requireTasks().get(id)
    if (task === undefined || task.status !== 'running') return
    const currentSessionId = this.currentSessionId(task)
    let events: readonly SessionEvent[]
    try {
      const live = this.ctx.sessions.get(currentSessionId)
      events = live?.events ?? (await this.ctx.sessionPersistence.inspect(currentSessionId)).events
    } catch {
      const failed = reconcileRound(task, {
        kind: 'failed',
        failure: {
          stage: 'recovery',
          code: 'SESSION_HISTORY_UNAVAILABLE',
          message: 'Session history could not be inspected.',
        },
      }, { now: Date.now() })
      await this.commitTask(failed, 'updated')
      return
    }
    const projection = this.projectSessionEvidence(task, currentSessionId, events)
    if (projection.evidence !== undefined) {
      const withEvidence = recordRoundEvidence(task, projection.evidence, Date.now())
      if (withEvidence !== task) {
        await this.commitTask(withEvidence, 'updated')
        task = withEvidence
      }
    }
    if (projection.outcome.kind === 'running') return
    const terminal = reconcileRound(task, projection.outcome, { now: Date.now() })
    await this.commitTask(terminal, 'updated')
  }

  private projectSessionEvidence(
    task: TaskBoardTask,
    currentSessionId: SessionId,
    events: readonly SessionEvent[],
  ): {
    readonly evidence?: TaskBoardRoundEvidence
    readonly outcome: TaskBoardRoundProjection
  } {
    const round = task.rounds.at(-1)
    if (round === undefined) return { outcome: { kind: 'running' } }
    let activeTurn: { readonly turn: number; readonly seq: number } | undefined
    let evidence: TaskBoardRoundEvidence | undefined
    let ending: Extract<SessionEvent, { type: 'turn/end' }> | undefined
    for (const event of events) {
      switch (event.type) {
        case 'turn/start':
          activeTurn = { turn: event.data.turn, seq: event.seq }
          break
        case 'user/message': {
          const source = event.data.source
          if (
            activeTurn !== undefined
            && source.kind === 'user'
            && 'rpcId' in source
            && source.rpcId === round.rpcId
          ) {
            evidence = {
              messageSeq: event.seq,
              turn: activeTurn.turn,
              startSeq: activeTurn.seq,
            }
          }
          break
        }
        case 'turn/end':
          if (evidence?.turn === event.data.turn) {
            ending = event
            evidence = { ...evidence, turnEndSeq: event.seq }
          }
          if (activeTurn?.turn === event.data.turn) activeTurn = undefined
          break
        default:
          break
      }
    }
    const agent = this.ctx.agents.get(currentSessionId)
    if (evidence === undefined || ending === undefined || (agent !== undefined && agent.status !== 'idle')) {
      return { ...(evidence === undefined ? {} : { evidence }), outcome: { kind: 'running' } }
    }
    return { evidence, outcome: this.projectTurnEnd(ending.data.reason, ending.seq) }
  }

  private projectTurnEnd(reason: TurnEndReason, endSeq: number): TaskBoardRoundProjection {
    switch (reason.kind) {
      case 'completed':
        return projectRoundOutcome([{ kind: 'completed', endSeq }])
      case 'error':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: reason.error.code,
            message: 'Execution failed. Open the Session for details.',
            seq: endSeq,
          },
        }])
      case 'aborted':
        return projectRoundOutcome([{
          kind: 'cancelled',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'CANCELLED',
            message: 'Execution was stopped.',
            seq: endSeq,
          },
        }])
      case 'blocked':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'BLOCKED',
            message: 'Execution was blocked.',
            seq: endSeq,
          },
        }])
      case 'max-tokens':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'MAX_TOKENS',
            message: 'Execution reached the output token limit.',
            seq: endSeq,
          },
        }])
      case 'interrupted':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'recovery',
            code: 'INTERRUPTED',
            message: 'Execution was interrupted before shutdown completed.',
            seq: endSeq,
          },
        }])
      default:
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'UNKNOWN_TURN_END',
            message: 'Execution ended with an unsupported result.',
            seq: endSeq,
          },
        }])
    }
  }

  private async commitTask(
    task: TaskBoardTask,
    operation: 'created' | 'updated',
  ): Promise<TaskBoardTask> {
    const global = this.requireGlobal().get()
    const boardRevision = global.boardRevision + 1
    await this.requireGlobal().set({ ...global, boardRevision })
    await this.requireTasks().put(task.id, task)
    this.emitChange({ boardRevision, operation, taskId: task.id, task })
    return snapshotTask(task)
  }

  private emitChange(change: TaskBoardChange): void {
    this.ctx.emit('task-board/changed', {
      ...change,
      ...(change.task === undefined ? {} : { task: snapshotTask(change.task) }),
    })
  }

  private enqueueMutation<T>(run: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) {
      return Promise.reject(new Error('task-board: mutation admission is closed'))
    }
    const result = this.mutationTail.then(run)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private requireTask(id: TaskBoardTaskId): TaskBoardTask {
    const task = this.requireTasks().get(id)
    if (task === undefined) throw new Error(`task-board: task '${id}' disappeared`)
    return task
  }

  private requireGlobal(): DomainGlobal<TaskBoardGlobal> {
    if (this.global === undefined) throw new Error('task-board: Storage Domain is not initialized')
    return this.global
  }

  private requireTasks(): KvTable<TaskBoardTaskId, TaskBoardTask> {
    if (this.tasks === undefined) throw new Error('task-board: Storage Domain is not initialized')
    return this.tasks
  }
}

export default TaskBoardService
