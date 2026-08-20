/** Public task-board records and Remote request vocabulary. @module @deepseek-ai/dsh-task-board/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one continuing task card. */
export type TaskBoardTaskId = Branded<'TaskBoardTaskId'>

/** Stable identity of one execution round within a task. */
export type TaskBoardRoundId = Branded<'TaskBoardRoundId'>

/** Correlates one task-board prompt with its Session admission event. */
export type TaskBoardRpcId = Branded<'TaskBoardRpcId'>

/** Human workflow state owned by the task board. */
export type TaskBoardStatus = 'initialized' | 'running' | 'review' | 'done' | 'failed'

/** User action that created an execution round. */
export type TaskBoardRoundTrigger = 'initial' | 'revision' | 'retry'

/** Durable execution state of one round. */
export type TaskBoardRoundStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'

/** Stable user-safe failure retained on a terminal round. */
export interface TaskBoardFailure {
  /** Lifecycle phase that produced the failure. */
  readonly stage: 'session-create' | 'prompt-admission' | 'execution' | 'recovery'
  /** Stable provider-independent failure code. */
  readonly code: string
  /** Redacted correction-oriented summary suitable for the Client. */
  readonly message: string
  /** Session turn associated with the failure when known. */
  readonly turn?: number | undefined
  /** Session event sequence associated with the failure when known. */
  readonly seq?: number | undefined
}

/** One attempt to advance a task through a Harness Session. */
export interface TaskBoardRound {
  /** Stable round identity. */
  readonly id: TaskBoardRoundId
  /** One-based contiguous position inside the task. */
  readonly ordinal: number
  /** User action that created the round. */
  readonly trigger: TaskBoardRoundTrigger
  /** Current durable execution state. */
  readonly status: TaskBoardRoundStatus
  /** Harness Session carrying the round. */
  readonly sessionId: SessionId
  /** RPC identity matched against the durable user message. */
  readonly rpcId: TaskBoardRpcId
  /** Exact user-facing text submitted for this round. */
  readonly prompt: string
  /** Host time when round admission began. */
  readonly startedAt: number
  /** Host time when the Session accepted the prompt. */
  readonly acceptedAt?: number | undefined
  /** Durable `user/message` sequence after acceptance. */
  readonly messageSeq?: number | undefined
  /** Session turn assigned to the accepted prompt. */
  readonly turn?: number | undefined
  /** First Session event sequence belonging to the round. */
  readonly startSeq?: number | undefined
  /** Matching terminal `turn/end` sequence. */
  readonly turnEndSeq?: number | undefined
  /** Last terminal Session event sequence belonging to the round. */
  readonly endSeq?: number | undefined
  /** Host time when the round reached a terminal state. */
  readonly endedAt?: number | undefined
  /** Required human rejection feedback for revision rounds. */
  readonly feedback?: string | undefined
  /** Stable terminal failure summary for failed or cancelled rounds. */
  readonly failure?: TaskBoardFailure | undefined
}

/** Durable task card with ordered execution-round summaries. */
export interface TaskBoardTask {
  /** Stable opaque card identity. */
  readonly id: TaskBoardTaskId
  /** Monotonic numeric identifier allocation. */
  readonly sequence: number
  /** Human-readable identifier derived from sequence. */
  readonly identifier: string
  /** Compare-and-set revision incremented by every material task mutation. */
  readonly revision: number
  /** Current display title. */
  readonly title: string
  /** Primary task requirement. */
  readonly description: string
  /** Human-verifiable completion conditions. */
  readonly acceptanceCriteria: string
  /** Current human workflow state. */
  readonly status: TaskBoardStatus
  /** Stable sortable value interpreted only within the current status. */
  readonly position: string
  /** Absolute working directory supplied to Session creation. */
  readonly cwd?: string | undefined
  /** Ordered one-based execution rounds. */
  readonly rounds: readonly TaskBoardRound[]
  /** Host creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host time of the most recent material mutation. */
  readonly updatedAt: number
  /** Human approval time while status is `done`. */
  readonly completedAt?: number | undefined
}

/** Compare-and-set reference required by every task mutation. */
export interface TaskBoardTaskRef {
  readonly id: TaskBoardTaskId
  readonly revision: number
}

/** Initial task content and optional immediate execution request. */
export interface TaskBoardCreateRequest {
  readonly title?: string
  readonly description: string
  readonly acceptanceCriteria: string
  readonly cwd?: string
  readonly start: boolean
}

/** Material task fields accepted outside active execution. */
export interface TaskBoardEditPatch {
  readonly title?: string
  readonly description?: string
  readonly acceptanceCriteria?: string
  readonly cwd?: string | null
}

/** Same-column placement request; omitted anchor appends to the column. */
export interface TaskBoardReorderRequest {
  readonly beforeTaskId?: TaskBoardTaskId
}

/** Required feedback that starts a revision round. */
export interface TaskBoardRejectRequest {
  readonly feedback: string
}

/** Authoritative immutable board projection. */
export interface TaskBoardSnapshot {
  readonly boardRevision: number
  readonly tasks: readonly TaskBoardTask[]
}

/** Committed mutation event forwarded to connected Clients. */
export interface TaskBoardChange {
  readonly boardRevision: number
  readonly operation: 'created' | 'updated' | 'deleted'
  readonly taskId: TaskBoardTaskId
  readonly task?: TaskBoardTask
}

/** Requested card does not exist. */
export interface TaskBoardTaskNotFound {
  readonly code: 'task-not-found'
  readonly taskId: TaskBoardTaskId
}

/** Mutation observed an obsolete task revision. */
export interface TaskBoardRevisionConflict {
  readonly code: 'revision-conflict'
  readonly current: TaskBoardTask
}

/** Requested operation is not legal from the current workflow state. */
export interface TaskBoardInvalidTransition {
  readonly code: 'invalid-transition'
  readonly status: TaskBoardStatus
  readonly operation: string
}

/** A task already has an active latest execution round. */
export interface TaskBoardRoundAlreadyActive {
  readonly code: 'round-already-active'
  readonly roundId: TaskBoardRoundId
}

/** Persisted Session cannot currently accept another prompt. */
export interface TaskBoardSessionUnavailable {
  readonly code: 'session-unavailable'
  readonly sessionId: SessionId
}

/** Ordinary Session prompt admission rejected the board prompt. */
export interface TaskBoardPromptRejected {
  readonly code: 'prompt-rejected'
  readonly failure: TaskBoardFailure
}

/** Request fields fail task-board validation. */
export interface TaskBoardInvalidRequest {
  readonly code: 'invalid-request'
  readonly field: string
  readonly message: string
}

/** Stable business failures returned without rejecting the Remote call. */
export type TaskBoardFailureResult =
  | TaskBoardTaskNotFound
  | TaskBoardRevisionConflict
  | TaskBoardInvalidTransition
  | TaskBoardRoundAlreadyActive
  | TaskBoardSessionUnavailable
  | TaskBoardPromptRejected
  | TaskBoardInvalidRequest

/** Successful task-board operation. */
export interface TaskBoardSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected task-board business operation. */
export interface TaskBoardRejected {
  readonly ok: false
  readonly error: TaskBoardFailureResult
}

/** Public operation result with stable business rejections. */
export type TaskBoardResult<T> = TaskBoardSuccess<T> | TaskBoardRejected

/** Result returned by task-card mutations. */
export type TaskBoardTaskResult = TaskBoardResult<TaskBoardTask>

/** Result returned by authoritative board reads. */
export type TaskBoardSnapshotResult = TaskBoardResult<TaskBoardSnapshot>

/** Successful deletion acknowledgement. */
export interface TaskBoardDeleteValue {
  readonly deleted: true
  readonly taskId: TaskBoardTaskId
}

/** Result returned by card deletion. */
export type TaskBoardDeleteResult = TaskBoardResult<TaskBoardDeleteValue>

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Publishes one fully committed task-board mutation.
     * @param change - Authoritative task projection or deletion tombstone.
     * @mode emit
     */
    'task-board/changed'(change: TaskBoardChange): void
  }
}
