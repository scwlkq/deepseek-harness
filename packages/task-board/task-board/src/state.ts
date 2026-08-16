/** Pure task-board workflow, ordering, prompt, and snapshot helpers. @module @deepseek-ai/dsh-task-board/src/state */

import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TaskBoardCreateRequest,
  TaskBoardEditPatch,
  TaskBoardFailure,
  TaskBoardReorderRequest,
  TaskBoardRound,
  TaskBoardRoundId,
  TaskBoardRoundTrigger,
  TaskBoardRpcId,
  TaskBoardSnapshot,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from './types.ts'

const POSITION_STEP = 1_000_000
const POSITION_WIDTH = 16
const STATUS_RANK: Readonly<Record<TaskBoardStatus, number>> = {
  initialized: 0,
  running: 1,
  review: 2,
  done: 3,
  failed: 4,
}

interface MutationMetadata {
  readonly now: number
}

type TaskBoardRecordPatch = {
  readonly [Key in keyof TaskBoardTask]?: TaskBoardTask[Key] | undefined
}

/** Deterministic allocation supplied by Host task creation. */
export interface TaskBoardCreateMetadata extends MutationMetadata {
  readonly id: TaskBoardTaskId
  readonly sequence: number
  readonly position: string
  readonly automaticTitleMaxChars: number
}

/** Deterministic allocation supplied when a round starts. */
export interface TaskBoardStartRoundInput extends MutationMetadata {
  readonly roundId: TaskBoardRoundId
  readonly sessionId: SessionId
  readonly rpcId: TaskBoardRpcId
  readonly trigger: TaskBoardRoundTrigger
  readonly prompt: string
  readonly feedback?: string
}

/** Durable evidence recorded after Session prompt admission. */
export interface TaskBoardRoundAdmission {
  readonly acceptedAt: number
  readonly messageSeq?: number
  readonly turn?: number
  readonly startSeq?: number
}

/** Durable Session evidence matched to the latest board prompt. */
export interface TaskBoardRoundEvidence {
  readonly messageSeq: number
  readonly turn: number
  readonly startSeq: number
  readonly turnEndSeq?: number
}

/** Deterministic identifiers used when rejection starts a revision round. */
export interface TaskBoardRejectRecordInput extends MutationMetadata {
  readonly feedback: string
  readonly roundId: TaskBoardRoundId
  readonly rpcId: TaskBoardRpcId
}

/** Deterministic identifiers used when a failed task starts a fresh retry. */
export interface TaskBoardRetryRecordInput extends MutationMetadata {
  readonly sessionId: SessionId
  readonly roundId: TaskBoardRoundId
  readonly rpcId: TaskBoardRpcId
}

/** Terminal evidence reduced from one round's Session events. */
export type TaskBoardRoundOutcomeSignal =
  | { readonly kind: 'completed'; readonly endSeq?: number }
  | { readonly kind: 'error'; readonly failure: TaskBoardFailure; readonly endSeq?: number }
  | { readonly kind: 'cancelled'; readonly failure: TaskBoardFailure; readonly endSeq?: number }

/** Current workflow projection from a round's durable Session evidence. */
export type TaskBoardRoundProjection =
  | { readonly kind: 'running' }
  | { readonly kind: 'review'; readonly endSeq?: number }
  | { readonly kind: 'failed'; readonly failure: TaskBoardFailure; readonly endSeq?: number }
  | { readonly kind: 'cancelled'; readonly failure: TaskBoardFailure; readonly endSeq?: number }

/** Reorder result containing every record whose position changed. */
export interface TaskBoardReorderResult {
  readonly task: TaskBoardTask
  readonly tasks: readonly TaskBoardTask[]
  readonly changed: readonly TaskBoardTask[]
}

/* v8 ignore next -- closed same-process unions make this diagnostic unreachable. */
function assertNever(value: never, subject: string): never {
  throw new Error(`unexpected ${subject}: ${String(value)}`)
}

/** Expected pure workflow rejection raised before durable mutation. */
export class TaskBoardStateError extends Error {
  override readonly name = 'TaskBoardStateError'
}

function stateError(message: string): TaskBoardStateError {
  return new TaskBoardStateError(`task-board ${message}`)
}

function requireTransition(task: TaskBoardTask, status: TaskBoardStatus, operation: string): void {
  if (task.status !== status) {
    throw stateError(`invalid transition: cannot ${operation} from ${task.status}`)
  }
}

function freezeTask(task: TaskBoardTask): TaskBoardTask {
  const snapshot = snapshotJsonValue(task)
  if (snapshot === undefined) throw stateError('task is not losslessly JSON serializable')
  return deepFreeze(snapshot)
}

function freezeSnapshot(snapshot: TaskBoardSnapshot): TaskBoardSnapshot {
  const value = snapshotJsonValue(snapshot)
  if (value === undefined) throw stateError('snapshot is not losslessly JSON serializable')
  return deepFreeze(value)
}

function nextTask(task: TaskBoardTask, now: number, patch: TaskBoardRecordPatch): TaskBoardTask {
  const candidate: Record<string, unknown> = {
    ...task,
    ...patch,
    revision: task.revision + 1,
    updatedAt: Math.max(now, task.updatedAt),
  }
  for (const key of ['cwd', 'completedAt']) {
    if (candidate[key] === undefined) Reflect.deleteProperty(candidate, key)
  }
  return freezeTask(candidate as unknown as TaskBoardTask)
}

function latestRound(task: TaskBoardTask): TaskBoardRound {
  const round = task.rounds.at(-1)
  if (round === undefined) throw stateError('task has no execution round')
  return round
}

function activeRound(task: TaskBoardTask): TaskBoardRound {
  const round = latestRound(task)
  if (round.status !== 'starting' && round.status !== 'running') {
    throw stateError('round is not active')
  }
  return round
}

function replaceLatestRound(task: TaskBoardTask, round: TaskBoardRound): readonly TaskBoardRound[] {
  return [...task.rounds.slice(0, -1), round]
}

function requireRoundStart(task: TaskBoardTask, trigger: TaskBoardRoundTrigger): void {
  const current = task.rounds.at(-1)
  if (current?.status === 'starting' || current?.status === 'running') {
    throw stateError(`round already active: ${current.id}`)
  }
  switch (trigger) {
    case 'initial':
      requireTransition(task, 'initialized', 'start')
      return
    case 'revision':
      requireTransition(task, 'review', 'reject')
      return
    case 'retry':
      requireTransition(task, 'failed', 'retry')
      return
    default:
      assertNever(trigger, 'round trigger')
  }
}

function automaticTitle(request: TaskBoardCreateRequest, maxChars: number): string {
  const source = request.description.trim() || request.acceptanceCriteria.trim()
  const firstLineEnd = source.search(/\r?\n/)
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)
  return Array.from(firstLine).slice(0, maxChars).join('')
}

function normalizedCwd(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  const value = cwd.trim()
  if (value.length === 0) throw stateError('cwd must not be blank')
  return value
}

function positionNumber(position: string): number | undefined {
  if (!/^\d+$/.test(position)) return undefined
  const value = Number(position)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function formatPosition(value: number): string {
  /* v8 ignore next -- callers pass bounded positive sums or one-based indexes. */
  if (!Number.isSafeInteger(value) || value < 1) throw stateError('position must be a positive safe integer')
  return String(value).padStart(POSITION_WIDTH, '0')
}

function positionBetween(previous: string | undefined, next: string | undefined): string | undefined {
  const previousValue = previous === undefined ? 0 : positionNumber(previous)
  const nextValue = next === undefined ? undefined : positionNumber(next)
  if (previousValue === undefined || (next !== undefined && nextValue === undefined)) return undefined
  if (nextValue === undefined) {
    const appended = previousValue + POSITION_STEP
    return Number.isSafeInteger(appended) ? formatPosition(appended) : undefined
  }
  const midpoint = Math.floor((previousValue + nextValue) / 2)
  return midpoint > previousValue && midpoint < nextValue ? formatPosition(midpoint) : undefined
}

/**
 * Create one immutable initialized task record.
 * @param request - User task fields.
 * @param metadata - Host-owned identity, ordering, and time allocation.
 * @returns New revision-zero task.
 */
export function createTaskRecord(
  request: TaskBoardCreateRequest,
  metadata: TaskBoardCreateMetadata,
): TaskBoardTask {
  const description = request.description.trim()
  const acceptanceCriteria = request.acceptanceCriteria.trim()
  if (description.length === 0 && acceptanceCriteria.length === 0) {
    throw stateError('description and acceptance criteria cannot both be blank')
  }
  const suppliedTitle = request.title?.trim() ?? ''
  const title = suppliedTitle || automaticTitle({ ...request, description, acceptanceCriteria }, metadata.automaticTitleMaxChars)
  if (title.length === 0) throw stateError('title cannot be blank')
  const cwd = normalizedCwd(request.cwd)
  return freezeTask({
    id: metadata.id,
    sequence: metadata.sequence,
    identifier: `DSH-${metadata.sequence}`,
    revision: 0,
    title,
    description,
    acceptanceCriteria,
    status: 'initialized',
    position: metadata.position,
    ...(cwd === undefined ? {} : { cwd }),
    rounds: [],
    createdAt: metadata.now,
    updatedAt: metadata.now,
  })
}

/**
 * Apply material task edits outside active execution.
 * @param task - Current authoritative task.
 * @param patch - Retained editable fields.
 * @param metadata - Host mutation time.
 * @returns Original task for a no-op or a new revision.
 */
export function editTaskRecord(
  task: TaskBoardTask,
  patch: TaskBoardEditPatch,
  metadata: MutationMetadata,
): TaskBoardTask {
  if (task.status === 'running') throw stateError('cannot edit while running')
  const description = patch.description === undefined ? task.description : patch.description.trim()
  const acceptanceCriteria = patch.acceptanceCriteria === undefined
    ? task.acceptanceCriteria
    : patch.acceptanceCriteria.trim()
  if (description.length === 0 && acceptanceCriteria.length === 0) {
    throw stateError('description and acceptance criteria cannot both be blank')
  }
  const requestedTitle = patch.title === undefined ? task.title : patch.title.trim()
  const title = requestedTitle || automaticTitle({
    description,
    acceptanceCriteria,
    start: false,
  }, 80)
  const cwd = patch.cwd === undefined
    ? task.cwd
    : patch.cwd === null
      ? undefined
      : normalizedCwd(patch.cwd)
  if (
    title === task.title
    && description === task.description
    && acceptanceCriteria === task.acceptanceCriteria
    && cwd === task.cwd
  ) return task
  return nextTask(task, metadata.now, {
    title,
    description,
    acceptanceCriteria,
    cwd,
  })
}

/**
 * Append one starting execution round and move the task to running.
 * @param task - Current authoritative task.
 * @param input - Host-owned Session and request identities.
 * @returns Task with one new starting round.
 */
export function startRoundRecord(task: TaskBoardTask, input: TaskBoardStartRoundInput): TaskBoardTask {
  requireRoundStart(task, input.trigger)
  const prompt = input.prompt.trim()
  if (prompt.length === 0) throw stateError('round prompt must not be blank')
  const round: TaskBoardRound = {
    id: input.roundId,
    ordinal: task.rounds.length + 1,
    trigger: input.trigger,
    status: 'starting',
    sessionId: input.sessionId,
    rpcId: input.rpcId,
    prompt,
    startedAt: input.now,
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
  }
  return nextTask(task, input.now, {
    status: 'running',
    rounds: [...task.rounds, round],
    completedAt: undefined,
  })
}

/**
 * Record successful prompt admission on the latest round.
 * @param task - Running task with a starting round.
 * @param admission - Durable user-message identity and Session sequence.
 * @returns Running task with an admitted round.
 */
export function markRoundRunningRecord(
  task: TaskBoardTask,
  admission: TaskBoardRoundAdmission,
): TaskBoardTask {
  requireTransition(task, 'running', 'record prompt admission')
  const round = activeRound(task)
  if (round.status !== 'starting') throw stateError('round prompt is already admitted')
  const updated: TaskBoardRound = {
    ...round,
    status: 'running',
    acceptedAt: admission.acceptedAt,
    ...(admission.messageSeq === undefined ? {} : { messageSeq: admission.messageSeq }),
    ...(admission.turn === undefined ? {} : { turn: admission.turn }),
    ...(admission.startSeq === undefined ? {} : { startSeq: admission.startSeq }),
  }
  return nextTask(task, admission.acceptedAt, { rounds: replaceLatestRound(task, updated) })
}

/**
 * Persist Session sequence evidence for the latest admitted round.
 * @param task - Running task with an active round.
 * @param evidence - User-message and turn sequence identities.
 * @param now - Host reconciliation time.
 * @returns Original task when unchanged or a new evidence revision.
 */
export function recordRoundEvidence(
  task: TaskBoardTask,
  evidence: TaskBoardRoundEvidence,
  now: number,
): TaskBoardTask {
  requireTransition(task, 'running', 'record round evidence')
  const round = activeRound(task)
  if (
    round.messageSeq === evidence.messageSeq
    && round.turn === evidence.turn
    && round.startSeq === evidence.startSeq
    && round.turnEndSeq === evidence.turnEndSeq
  ) return task
  const updated: TaskBoardRound = {
    ...round,
    messageSeq: evidence.messageSeq,
    turn: evidence.turn,
    startSeq: evidence.startSeq,
    ...(evidence.turnEndSeq === undefined ? {} : { turnEndSeq: evidence.turnEndSeq }),
  }
  return nextTask(task, now, { rounds: replaceLatestRound(task, updated) })
}

/**
 * Finish a round whose Session or prompt admission failed.
 * @param task - Running task with an active round.
 * @param failure - Stable admission failure.
 * @param metadata - Host mutation time.
 * @returns Failed task retaining the round summary.
 */
export function failRoundAdmissionRecord(
  task: TaskBoardTask,
  failure: TaskBoardFailure,
  metadata: MutationMetadata,
): TaskBoardTask {
  requireTransition(task, 'running', 'fail admission')
  const round = activeRound(task)
  const updated: TaskBoardRound = {
    ...round,
    status: 'failed',
    failure,
    endedAt: metadata.now,
    ...(failure.seq === undefined ? {} : { endSeq: failure.seq }),
  }
  return nextTask(task, metadata.now, {
    status: 'failed',
    rounds: replaceLatestRound(task, updated),
  })
}

/**
 * Record a user-requested stop after cancellation admission succeeds.
 * @param task - Running task whose current Session was cancelled.
 * @param metadata - Host mutation time.
 * @returns Failed task with a cancelled round.
 */
export function requestStopRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask {
  requireTransition(task, 'running', 'stop')
  const round = activeRound(task)
  const failure: TaskBoardFailure = {
    stage: 'execution',
    code: 'stopped',
    message: 'Execution stopped by the user.',
  }
  const updated: TaskBoardRound = {
    ...round,
    status: 'cancelled',
    failure,
    endedAt: metadata.now,
  }
  return nextTask(task, metadata.now, {
    status: 'failed',
    rounds: replaceLatestRound(task, updated),
  })
}

/**
 * Start a rejection-feedback round in the current Session.
 * @param task - Reviewed task.
 * @param input - Feedback and deterministic request identities.
 * @returns Running task with a revision round.
 */
export function rejectTaskRecord(
  task: TaskBoardTask,
  input: TaskBoardRejectRecordInput,
): TaskBoardTask {
  requireTransition(task, 'review', 'reject')
  const feedback = input.feedback.trim()
  if (feedback.length === 0) throw stateError('rejection feedback must not be blank')
  const sessionId = latestRound(task).sessionId
  return startRoundRecord(task, {
    roundId: input.roundId,
    sessionId,
    rpcId: input.rpcId,
    trigger: 'revision',
    prompt: feedback,
    feedback,
    now: input.now,
  })
}

/**
 * Start a failed task again in a fresh Session.
 * @param task - Failed task.
 * @param input - Fresh Session and deterministic request identities.
 * @returns Running task with a retry round.
 */
export function retryTaskRecord(
  task: TaskBoardTask,
  input: TaskBoardRetryRecordInput,
): TaskBoardTask {
  requireTransition(task, 'failed', 'retry')
  const previous = latestRound(task)
  if (previous.sessionId === input.sessionId) throw stateError('retry requires a fresh Session')
  return startRoundRecord(task, {
    roundId: input.roundId,
    sessionId: input.sessionId,
    rpcId: input.rpcId,
    trigger: 'retry',
    prompt: `Retry task after previous execution failed.\n\n${composeInitialPrompt(task)}`,
    now: input.now,
  })
}

/**
 * Reduce ordered terminal Session evidence to one workflow projection.
 * @param signals - Terminal signals in Session event order.
 * @returns Running when absent, otherwise the latest terminal outcome.
 */
export function projectRoundOutcome(
  signals: readonly TaskBoardRoundOutcomeSignal[],
): TaskBoardRoundProjection {
  const latest = signals.at(-1)
  if (latest === undefined) return { kind: 'running' }
  switch (latest.kind) {
    case 'completed':
      return { kind: 'review', ...(latest.endSeq === undefined ? {} : { endSeq: latest.endSeq }) }
    case 'error':
      return {
        kind: 'failed',
        failure: latest.failure,
        ...(latest.endSeq === undefined ? {} : { endSeq: latest.endSeq }),
      }
    case 'cancelled':
      return {
        kind: 'cancelled',
        failure: latest.failure,
        ...(latest.endSeq === undefined ? {} : { endSeq: latest.endSeq }),
      }
    default:
      return assertNever(latest, 'round outcome signal')
  }
}

/**
 * Apply a Session-derived outcome to the active round.
 * @param task - Running task.
 * @param projection - Current durable Session outcome.
 * @param metadata - Host reconciliation time.
 * @returns Original running task or one terminal workflow revision.
 */
export function reconcileRound(
  task: TaskBoardTask,
  projection: TaskBoardRoundProjection,
  metadata: MutationMetadata,
): TaskBoardTask {
  requireTransition(task, 'running', 'reconcile')
  if (projection.kind === 'running') return task
  const round = activeRound(task)
  const terminal = projection.kind === 'review'
    ? {
      status: 'completed' as const,
      taskStatus: 'review' as const,
      failure: undefined,
    }
    : {
      status: projection.kind,
      taskStatus: 'failed' as const,
      failure: projection.failure,
    }
  const updated: TaskBoardRound = {
    ...round,
    status: terminal.status,
    endedAt: metadata.now,
    ...(projection.endSeq === undefined ? {} : { endSeq: projection.endSeq }),
    ...(terminal.failure === undefined ? {} : { failure: terminal.failure }),
  }
  return nextTask(task, metadata.now, {
    status: terminal.taskStatus,
    rounds: replaceLatestRound(task, updated),
  })
}

/**
 * Mark a successfully executed reviewed task complete.
 * @param task - Reviewed task.
 * @param metadata - Human approval time.
 * @returns Completed task revision.
 */
export function approveTaskRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask {
  requireTransition(task, 'review', 'approve')
  return nextTask(task, metadata.now, { status: 'done', completedAt: metadata.now })
}

/**
 * Reopen a completed task while preserving round summaries.
 * @param task - Completed task.
 * @param metadata - Human reopen time.
 * @returns Initialized task revision.
 */
export function reopenTaskRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask {
  requireTransition(task, 'done', 'reopen')
  return nextTask(task, metadata.now, { status: 'initialized', completedAt: undefined })
}

/**
 * Reorder one task within its current status column.
 * @param task - Current authoritative task.
 * @param siblings - Complete tasks in that status column.
 * @param request - Optional insertion anchor.
 * @param metadata - Host mutation time.
 * @returns Ordered tasks and every changed task record.
 */
export function reorderTaskRecord(
  task: TaskBoardTask,
  siblings: readonly TaskBoardTask[],
  request: TaskBoardReorderRequest,
  metadata: MutationMetadata,
): TaskBoardReorderResult {
  if (siblings.some(sibling => sibling.status !== task.status)) {
    throw stateError('reorder requires siblings with the same status')
  }
  const matching = siblings.filter(sibling => sibling.id === task.id)
  if (matching.length !== 1) throw stateError('reorder requires task exactly once')
  const ordered = [...siblings].sort((left, right) => {
    const position = left.position.localeCompare(right.position)
    return position !== 0 ? position : left.sequence - right.sequence
  })
  const withoutTask = ordered.filter(sibling => sibling.id !== task.id)
  let insertAt = withoutTask.length
  if (request.beforeTaskId !== undefined && request.beforeTaskId !== task.id) {
    insertAt = withoutTask.findIndex(sibling => sibling.id === request.beforeTaskId)
    if (insertAt === -1) throw stateError('reorder anchor is not in the same status')
  } else if (request.beforeTaskId === task.id) {
    return { task, tasks: ordered, changed: [] }
  }
  const previous = withoutTask[insertAt - 1]
  const next = withoutTask[insertAt]
  const directPosition = positionBetween(previous?.position, next?.position)
  if (directPosition !== undefined) {
    if (directPosition === task.position) return { task, tasks: ordered, changed: [] }
    const moved = nextTask(task, metadata.now, { position: directPosition })
    const tasks = [...withoutTask]
    tasks.splice(insertAt, 0, moved)
    return { task: moved, tasks, changed: [moved] }
  }
  const rebalancedOrder = [...withoutTask]
  rebalancedOrder.splice(insertAt, 0, task)
  const changed: TaskBoardTask[] = []
  const tasks = rebalancedOrder.map((current, index) => {
    const position = formatPosition((index + 1) * POSITION_STEP)
    if (position === current.position) return current
    const replacement = nextTask(current, metadata.now, { position })
    changed.push(replacement)
    return replacement
  })
  const moved = tasks.find(current => current.id === task.id)
  /* v8 ignore next -- the task is inserted into rebalancedOrder immediately above. */
  if (moved === undefined) throw stateError('reordered task disappeared')
  return { task: moved, tasks, changed }
}

/**
 * Decide whether deletion is legal after required confirmation.
 * @param task - Current authoritative task.
 * @param confirmed - Human confirmation for reviewed or terminal work.
 * @returns Whether deletion may proceed.
 */
export function deleteAllowed(task: TaskBoardTask, confirmed: boolean): boolean {
  switch (task.status) {
    case 'initialized':
      return true
    case 'review':
    case 'done':
    case 'failed':
      return confirmed
    case 'running':
      return false
    default:
      return assertNever(task.status, 'task status')
  }
}

/**
 * Create a detached deeply frozen task projection.
 * @param task - Internal authoritative task record.
 * @returns Immutable JSON-safe task.
 */
export function snapshotTask(task: TaskBoardTask): TaskBoardTask {
  return freezeTask(task)
}

/**
 * Create a detached deeply frozen board projection.
 * @param tasks - Authoritative task records.
 * @param boardRevision - Global committed board revision.
 * @returns Tasks sorted by status and position.
 */
export function snapshotBoard(
  tasks: readonly TaskBoardTask[],
  boardRevision: number,
): TaskBoardSnapshot {
  const sorted = tasks.map(snapshotTask).sort((left, right) => {
    const status = STATUS_RANK[left.status] - STATUS_RANK[right.status]
    if (status !== 0) return status
    const position = left.position.localeCompare(right.position)
    return position !== 0 ? position : left.sequence - right.sequence
  })
  return freezeSnapshot({ boardRevision, tasks: sorted })
}

/**
 * Build the ordinary initial Session prompt from task content.
 * @param task - Task whose requirement enters model history.
 * @returns Prompt text with acceptance criteria when supplied.
 */
export function composeInitialPrompt(task: TaskBoardTask): string {
  const description = task.description.trim()
  const criteria = task.acceptanceCriteria.trim()
  if (criteria.length === 0) return description
  if (description.length === 0) return `Acceptance criteria:\n${criteria}`
  return `${description}\n\nAcceptance criteria:\n${criteria}`
}
