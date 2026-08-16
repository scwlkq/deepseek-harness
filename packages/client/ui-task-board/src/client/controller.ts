/** Browser-side authoritative task-board synchronization. @module @deepseek-ai/dsh-client-ui-task-board/client/controller */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardDeleteResult,
  TaskBoardDeleteValue,
  TaskBoardEditPatch,
  TaskBoardFailureResult,
  TaskBoardRejectRequest,
  TaskBoardReorderRequest,
  TaskBoardResult,
  TaskBoardSnapshotResult,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
  TaskBoardTaskRef,
  TaskBoardTaskResult,
} from '@deepseek-ai/dsh-task-board/types'

/** Generated task-board Remote methods consumed by the browser. */
export interface TaskBoardRemote {
  snapshot: () => Promise<RemoteResult<TaskBoardSnapshotResult>>
  create: (request: TaskBoardCreateRequest) => Promise<RemoteResult<TaskBoardTaskResult>>
  edit: (ref: TaskBoardTaskRef, patch: TaskBoardEditPatch) => Promise<RemoteResult<TaskBoardTaskResult>>
  reorder: (
    ref: TaskBoardTaskRef,
    request: TaskBoardReorderRequest,
  ) => Promise<RemoteResult<TaskBoardTaskResult>>
  start: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  approve: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  reject: (
    ref: TaskBoardTaskRef,
    request: TaskBoardRejectRequest,
  ) => Promise<RemoteResult<TaskBoardTaskResult>>
  retry: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  stop: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  reopen: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  delete: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardDeleteResult>>
}

/** Browser snapshot loading state. */
export type TaskBoardClientStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable browser projection shared by both task-board slots. */
export interface TaskBoardClientView {
  readonly status: TaskBoardClientStatus
  readonly boardRevision: number
  readonly tasks: readonly TaskBoardTask[]
  readonly pendingTaskIds: readonly TaskBoardTaskId[]
  readonly creating: boolean
  readonly error: RemoteFailure | TaskBoardFailureResult | null
}

/** Remote transport and stable task-board business result. */
export type TaskBoardClientResult<T> = TaskBoardResult<T> | {
  readonly ok: false
  readonly error: RemoteFailure
}

const STATUS_ORDER: Readonly<Record<TaskBoardStatus, number>> = {
  initialized: 0,
  running: 1,
  review: 2,
  done: 3,
  failed: 4,
}

const INITIAL_VIEW: TaskBoardClientView = Object.freeze({
  status: 'cold',
  boardRevision: 0,
  tasks: Object.freeze([]),
  pendingTaskIds: Object.freeze([]),
  creating: false,
  error: null,
})

function ordered(tasks: readonly TaskBoardTask[]): readonly TaskBoardTask[] {
  return [...tasks].sort((left, right) => {
    const status = STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    if (status !== 0) return status
    const position = left.position.localeCompare(right.position)
    if (position !== 0) return position
    return left.sequence - right.sequence
  })
}

function transportError(error: unknown): RemoteFailure {
  return {
    code: 'client-operation-failed',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

function pendingError(taskId: TaskBoardTaskId): RemoteFailure {
  return {
    code: 'client-operation-pending',
    message: `Task '${taskId}' already has a pending operation.`,
    details: { taskId },
  }
}

function notFound(taskId: TaskBoardTaskId): TaskBoardClientResult<never> {
  return { ok: false, error: { code: 'task-not-found', taskId } }
}

/**
 * Format a browser-safe task-board error.
 * @param error - transport or stable business failure.
 * @returns Host message when present, otherwise its stable code.
 */
export function taskBoardErrorMessage(error: RemoteFailure | TaskBoardFailureResult): string {
  return 'message' in error ? error.message : error.code
}

/** Owns task-board Remote synchronization and pending mutation state. */
export class TaskBoardController implements HostObservable<TaskBoardClientView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private readonly pendingTaskIds = new Set<TaskBoardTaskId>()
  private refreshPromise: Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> | null = null
  private disposed = false

  /** @param remote - generated `taskBoard` Remote namespace. */
  constructor(private readonly remote: TaskBoardRemote) {}

  /** @returns current immutable browser projection. */
  getSnapshot = (): TaskBoardClientView => this.view

  /**
   * Subscribe to browser projection updates.
   * @param listener - callback invoked after each committed projection.
   * @returns unsubscribe callback.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stop accepting updates and release listeners. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /**
   * Read one full authoritative snapshot, coalescing concurrent callers.
   * @returns normalized task list or stable failure.
   */
  refresh(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> {
    if (this.disposed) {
      return Promise.resolve({
        ok: false,
        error: transportError(new Error('task-board controller disposed')),
      })
    }
    if (this.refreshPromise !== null) return this.refreshPromise

    this.patch({ status: 'loading', error: null })
    const pending = this.readSnapshot()
    this.refreshPromise = pending
    void pending.finally(() => {
      this.refreshPromise = null
    })
    return pending
  }

  /**
   * Reconcile one committed Host change, refreshing on any revision gap.
   * @param change - revisioned task-board event.
   * @returns completion of any required snapshot repair.
   */
  async acceptChange(change: TaskBoardChange): Promise<void> {
    if (this.disposed) return
    if (this.refreshPromise !== null) await this.refreshPromise
    if (change.boardRevision <= this.view.boardRevision) return
    if (this.view.status === 'cold' || change.boardRevision !== this.view.boardRevision + 1) {
      await this.refresh()
      return
    }

    if (change.operation === 'deleted') {
      this.commit({
        ...this.view,
        boardRevision: change.boardRevision,
        tasks: this.view.tasks.filter(task => task.id !== change.taskId),
        error: null,
      })
      return
    }
    if (change.task === undefined) {
      await this.refresh()
      return
    }
    this.commit({
      ...this.view,
      boardRevision: change.boardRevision,
      tasks: this.upsert(this.view.tasks, change.task),
      error: null,
    })
  }

  /**
   * Invalidate the projection after a transport reset and request a fresh snapshot.
   * @returns completion of the replacement snapshot.
   */
  async connectionReset(): Promise<void> {
    if (this.disposed) return
    this.patch({ status: 'cold', boardRevision: 0, error: null })
    await this.refresh()
  }

  /**
   * Create a task, optionally starting its first Session.
   * @param request - retained task fields and explicit start intent.
   * @returns created authoritative task or stable failure.
   */
  async create(request: TaskBoardCreateRequest): Promise<TaskBoardClientResult<TaskBoardTask>> {
    if (this.view.creating) return {
      ok: false,
      error: {
        code: 'client-operation-pending',
        message: 'Task creation already pending.',
        details: {},
      },
    }
    this.patch({ creating: true, error: null })
    try {
      const result = await this.unwrap(this.remote.create(request))
      if (!result.ok) return result
      this.replaceTask(result.value)
      return result
    } finally {
      this.patch({ creating: false })
    }
  }

  /**
   * Edit retained task fields.
   * @param taskId - Task identity.
   * @param patch - Retained field replacements.
   * @returns Task mutation result.
   */
  edit(taskId: TaskBoardTaskId, patch: TaskBoardEditPatch): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.edit(ref, patch))
  }

  /**
   * Reorder a task within its current column.
   * @param taskId - Moved task.
   * @param beforeTaskId - Optional same-column anchor.
   * @returns Task mutation result.
   */
  reorder(
    taskId: TaskBoardTaskId,
    beforeTaskId?: TaskBoardTaskId,
  ): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.reorder(
      ref,
      beforeTaskId === undefined ? {} : { beforeTaskId },
    ))
  }

  /**
   * Start an initialized task.
   * @param taskId - Initialized task.
   * @returns Task mutation result.
   */
  start(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.start(ref))
  }

  /**
   * Approve a reviewed task.
   * @param taskId - Reviewed task.
   * @returns Task mutation result.
   */
  approve(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.approve(ref))
  }

  /**
   * Reject a reviewed task with revision feedback.
   * @param taskId - Reviewed task.
   * @param feedback - Required revision request.
   * @returns Task mutation result.
   */
  reject(taskId: TaskBoardTaskId, feedback: string): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.reject(ref, { feedback }))
  }

  /**
   * Retry a failed task.
   * @param taskId - Failed task.
   * @returns Task mutation result.
   */
  retry(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.retry(ref))
  }

  /**
   * Stop a running task.
   * @param taskId - Running task.
   * @returns Task mutation result.
   */
  stop(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.stop(ref))
  }

  /**
   * Return a completed task to initialized state.
   * @param taskId - Completed task.
   * @returns Task mutation result.
   */
  reopen(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.reopen(ref))
  }

  /**
   * Delete a removable task.
   * @param taskId - Removable task.
   * @returns Deletion acknowledgement or stable failure.
   */
  async delete(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardDeleteValue>> {
    const current = this.view.tasks.find(task => task.id === taskId)
    if (current === undefined) return notFound(taskId)
    if (this.pendingTaskIds.has(taskId)) return { ok: false, error: pendingError(taskId) }

    this.setPending(taskId, true)
    try {
      const result = await this.unwrap(this.remote.delete({ id: taskId, revision: current.revision }))
      if (!result.ok) {
        this.reconcileConflict(result.error)
        return result
      }
      this.patch({ tasks: this.view.tasks.filter(task => task.id !== taskId) })
      return result
    } finally {
      this.setPending(taskId, false)
    }
  }

  private async readSnapshot(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> {
    const result = await this.unwrap(this.remote.snapshot())
    if (!result.ok) {
      this.patch({ status: 'error', error: result.error })
      return result
    }
    const tasks = ordered(result.value.tasks)
    this.commit({
      ...this.view,
      status: 'ready',
      boardRevision: result.value.boardRevision,
      tasks,
      error: null,
    })
    return { ok: true, value: tasks }
  }

  private async mutateTask(
    taskId: TaskBoardTaskId,
    invoke: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>,
  ): Promise<TaskBoardClientResult<TaskBoardTask>> {
    const current = this.view.tasks.find(task => task.id === taskId)
    if (current === undefined) return notFound(taskId)
    if (this.pendingTaskIds.has(taskId)) return { ok: false, error: pendingError(taskId) }

    this.setPending(taskId, true)
    try {
      const result = await this.unwrap(invoke({ id: taskId, revision: current.revision }))
      if (!result.ok) {
        this.reconcileConflict(result.error)
        return result
      }
      this.replaceTask(result.value)
      return result
    } finally {
      this.setPending(taskId, false)
    }
  }

  private async unwrap<T>(pending: Promise<RemoteResult<TaskBoardResult<T>>>): Promise<TaskBoardClientResult<T>> {
    try {
      const carried = await pending
      return carried.ok ? carried.value : { ok: false, error: carried.error }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  }

  private reconcileConflict(error: RemoteFailure | TaskBoardFailureResult): void {
    if (error.code === 'revision-conflict' && 'current' in error) this.replaceTask(error.current)
  }

  private replaceTask(task: TaskBoardTask): void {
    const observed = this.view.tasks.find(item => item.id === task.id)
    if (observed !== undefined && observed.revision > task.revision) return
    this.patch({ tasks: this.upsert(this.view.tasks, task), error: null })
  }

  private upsert(tasks: readonly TaskBoardTask[], task: TaskBoardTask): readonly TaskBoardTask[] {
    const retained = tasks.filter(item => item.id !== task.id)
    return ordered([...retained, task])
  }

  private setPending(taskId: TaskBoardTaskId, pending: boolean): void {
    if (pending) this.pendingTaskIds.add(taskId)
    else this.pendingTaskIds.delete(taskId)
    this.patch({ pendingTaskIds: [...this.pendingTaskIds] })
  }

  private patch(patch: Partial<TaskBoardClientView>): void {
    this.commit({ ...this.view, ...patch })
  }

  private commit(view: TaskBoardClientView): void {
    if (this.disposed) return
    this.view = Object.freeze(view)
    for (const listener of this.listeners) listener()
  }
}
