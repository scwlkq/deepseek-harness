import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import {
  taskBoardGlobalSchema,
  taskBoardTaskSchema,
} from '../src/spec.ts'
import {
  approveTaskRecord,
  composeInitialPrompt,
  createTaskRecord,
  deleteAllowed,
  editTaskRecord,
  markRoundRunningRecord,
  projectRoundOutcome,
  reconcileRound,
  rejectTaskRecord,
  reopenTaskRecord,
  reorderTaskRecord,
  retryTaskRecord,
  snapshotBoard,
  snapshotTask,
  startRoundRecord,
} from '../src/state.ts'
import type {
  TaskBoardRoundId,
  TaskBoardRpcId,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../src/types.ts'

function taskId(value: string): TaskBoardTaskId {
  return value as TaskBoardTaskId
}

function roundId(value: string): TaskBoardRoundId {
  return value as TaskBoardRoundId
}

function rpcId(value: string): TaskBoardRpcId {
  return value as TaskBoardRpcId
}

function sessionId(value: string): SessionId {
  return value as SessionId
}

function createTask(sequence = 1): TaskBoardTask {
  return createTaskRecord({
    title: '',
    description: `Implement task ${sequence}`,
    acceptanceCriteria: 'The task is demonstrably complete.',
    cwd: '/tmp/project',
    start: false,
  }, {
    id: taskId(`task-${sequence}`),
    sequence,
    position: String(sequence * 1_000_000).padStart(16, '0'),
    now: sequence,
    automaticTitleMaxChars: 80,
  })
}

function startTask(task = createTask()): TaskBoardTask {
  const started = startRoundRecord(task, {
    roundId: roundId(`round-${task.rounds.length + 1}`),
    sessionId: sessionId(`session-${task.rounds.length + 1}`),
    rpcId: rpcId(`rpc-${task.rounds.length + 1}`),
    trigger: 'initial',
    prompt: composeInitialPrompt(task),
    now: 10,
  })
  return markRoundRunningRecord(started, {
    acceptedAt: 11,
    messageSeq: 12,
    turn: 1,
    startSeq: 12,
  })
}

describe('task-board MVP durable schemas', () => {
  it('accepts the compact task record and rejects removed persisted fields', () => {
    const task = createTask()

    expect(taskBoardGlobalSchema.parse({ nextSequence: 2, boardRevision: 1 })).toEqual({
      nextSequence: 2,
      boardRevision: 1,
    })
    expect(taskBoardTaskSchema.safeParse(task).success).toBe(true)
    expect(taskBoardTaskSchema.safeParse({ ...task, attachments: [] }).success).toBe(false)
    expect(taskBoardTaskSchema.safeParse({ ...task, activity: [] }).success).toBe(false)
    expect(taskBoardTaskSchema.safeParse({ ...task, agentPreset: 'reviewer' }).success).toBe(false)
  })
})

describe('task-board MVP workflow', () => {
  it('moves a successful task through running, review, and done', () => {
    const initialized = createTask()
    const running = startTask(initialized)
    const review = reconcileRound(running, { kind: 'review', endSeq: 20 }, { now: 21 })
    const done = approveTaskRecord(review, { now: 22 })

    expect(initialized.status).toBe('initialized')
    expect(running).toMatchObject({ status: 'running', revision: 2 })
    expect(running.rounds[0]).toMatchObject({
      status: 'running',
      sessionId: 'session-1',
      rpcId: 'rpc-1',
      messageSeq: 12,
      turn: 1,
    })
    expect(review).toMatchObject({ status: 'review', revision: 3 })
    expect(review.rounds[0]).toMatchObject({ status: 'completed', endSeq: 20, endedAt: 21 })
    expect(done).toMatchObject({ status: 'done', completedAt: 22, revision: 4 })
  })

  it('submits rejection feedback in the existing Session', () => {
    const running = startTask()
    const review = reconcileRound(running, { kind: 'review', endSeq: 20 }, { now: 21 })
    const rejected = rejectTaskRecord(review, {
      feedback: 'Add the empty-state behavior.',
      roundId: roundId('round-2'),
      rpcId: rpcId('rpc-2'),
      now: 22,
    })

    expect(rejected.status).toBe('running')
    expect(rejected.rounds).toHaveLength(2)
    expect(rejected.rounds[1]).toMatchObject({
      ordinal: 2,
      trigger: 'revision',
      status: 'starting',
      sessionId: running.rounds[0]?.sessionId,
      rpcId: 'rpc-2',
      prompt: 'Add the empty-state behavior.',
      feedback: 'Add the empty-state behavior.',
    })
  })

  it('retries a failed task in a fresh Session without a policy request', () => {
    const running = startTask()
    const failed = reconcileRound(running, {
      kind: 'failed',
      endSeq: 20,
      failure: {
        stage: 'execution',
        code: 'provider-error',
        message: 'The model request failed.',
      },
    }, { now: 21 })
    const retried = retryTaskRecord(failed, {
      sessionId: sessionId('session-2'),
      roundId: roundId('round-2'),
      rpcId: rpcId('rpc-2'),
      now: 22,
    })

    expect(retried.status).toBe('running')
    expect(retried.rounds[1]).toMatchObject({
      trigger: 'retry',
      status: 'starting',
      sessionId: 'session-2',
      rpcId: 'rpc-2',
    })
    expect(retried.rounds[1]?.prompt).toContain('Retry task after previous execution failed.')
    expect(retried.rounds[1]?.sessionId).not.toBe(retried.rounds[0]?.sessionId)
  })

  it('projects completed, failed, and cancelled terminal evidence', () => {
    const failure = {
      stage: 'execution' as const,
      code: 'provider-error',
      message: 'The model request failed.',
    }

    expect(projectRoundOutcome([])).toEqual({ kind: 'running' })
    expect(projectRoundOutcome([{ kind: 'completed', endSeq: 3 }])).toEqual({
      kind: 'review',
      endSeq: 3,
    })
    expect(projectRoundOutcome([
      { kind: 'completed', endSeq: 3 },
      { kind: 'error', failure, endSeq: 4 },
    ])).toEqual({ kind: 'failed', failure, endSeq: 4 })
    expect(projectRoundOutcome([{ kind: 'cancelled', failure, endSeq: 5 }])).toEqual({
      kind: 'cancelled',
      failure,
      endSeq: 5,
    })
  })

  it('edits the retained fields and clears the optional working directory', () => {
    const task = createTask()
    const edited = editTaskRecord(task, {
      title: 'Manual title',
      description: 'Updated description',
      acceptanceCriteria: 'Updated criteria',
      cwd: null,
    }, { now: 30 })

    expect(edited).toMatchObject({
      title: 'Manual title',
      description: 'Updated description',
      acceptanceCriteria: 'Updated criteria',
      revision: 1,
      updatedAt: 30,
    })
    expect(edited).not.toHaveProperty('cwd')
    expect(editTaskRecord(edited, {}, { now: 31 })).toBe(edited)
  })

  it('reorders only within one status and keeps deterministic snapshots', () => {
    const first = createTask(1)
    const second = createTask(2)
    const third = createTask(3)
    const reordered = reorderTaskRecord(second, [first, second, third], {
      beforeTaskId: first.id,
    }, { now: 40 })

    expect(reordered.tasks.map(task => task.id)).toEqual([second.id, first.id, third.id])
    expect(reordered.task.position < first.position).toBe(true)
    expect(() => reorderTaskRecord(second, [first, startTask(second), third], {
      beforeTaskId: first.id,
    }, { now: 41 })).toThrow(/same status/)

    const taskSnapshot = snapshotTask(reordered.task)
    const boardSnapshot = snapshotBoard(reordered.tasks, 9)
    expect(Object.isFrozen(taskSnapshot)).toBe(true)
    expect(Object.isFrozen(boardSnapshot)).toBe(true)
    expect(boardSnapshot.boardRevision).toBe(9)
  })

  it('composes the only initial prompt and preserves review history on reopen', () => {
    const initialized = createTask()
    expect(composeInitialPrompt(initialized)).toBe([
      'Implement task 1',
      '',
      'Acceptance criteria:',
      'The task is demonstrably complete.',
    ].join('\n'))

    const review = reconcileRound(startTask(initialized), { kind: 'review', endSeq: 20 }, { now: 21 })
    const done = approveTaskRecord(review, { now: 22 })
    const reopened = reopenTaskRecord(done, { now: 23 })

    expect(deleteAllowed(done, false)).toBe(false)
    expect(deleteAllowed(done, true)).toBe(true)
    expect(reopened).toMatchObject({ status: 'initialized', revision: 5 })
    expect(reopened.rounds).toEqual(done.rounds)
    expect(reopened).not.toHaveProperty('completedAt')
  })
})
