// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardDeleteResult,
  TaskBoardRound,
  TaskBoardSnapshotResult,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
  TaskBoardTaskResult,
} from '@deepseek-ai/dsh-task-board/types'
import { CreateTaskDialog } from '../src/client/CreateTaskDialog.tsx'
import {
  TaskBoardController,
  type TaskBoardRemote,
} from '../src/client/controller.ts'
import { resolveTaskDrop, TASK_BOARD_COLUMN_PREFIX } from '../src/client/drag.ts'
import { zh } from '../src/client/locales.ts'
import { TaskBoardView } from '../src/client/TaskBoardView.tsx'
import { TaskDetail } from '../src/client/TaskDetail.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

function task(
  sequence: number,
  status: TaskBoardStatus = 'initialized',
  revision = 1,
): TaskBoardTask {
  return {
    id: `task-${sequence}` as TaskBoardTaskId,
    sequence,
    identifier: `DSH-${sequence}`,
    revision,
    title: `Task ${sequence}`,
    description: `Requirement ${sequence}`,
    acceptanceCriteria: `Acceptance ${sequence}`,
    status,
    position: String(sequence).padStart(8, '0'),
    rounds: [],
    createdAt: sequence,
    updatedAt: sequence,
  }
}

function carried<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value }
}

function snapshotResult(
  boardRevision: number,
  tasks: readonly TaskBoardTask[],
): RemoteResult<TaskBoardSnapshotResult> {
  return carried({ ok: true, value: { boardRevision, tasks } })
}

function taskResult(value: TaskBoardTask): RemoteResult<TaskBoardTaskResult> {
  return carried({ ok: true, value })
}

function invalidTaskResult(): RemoteResult<TaskBoardTaskResult> {
  return carried({
    ok: false,
    error: {
      code: 'invalid-transition',
      status: 'initialized',
      operation: 'test',
    },
  })
}

function invalidDeleteResult(): RemoteResult<TaskBoardDeleteResult> {
  return carried({
    ok: false,
    error: {
      code: 'invalid-transition',
      status: 'initialized',
      operation: 'delete',
    },
  })
}

function remote(overrides: Partial<TaskBoardRemote> = {}): TaskBoardRemote {
  return {
    snapshot: vi.fn(async () => snapshotResult(0, [])),
    create: vi.fn(async () => invalidTaskResult()),
    edit: vi.fn(async () => invalidTaskResult()),
    reorder: vi.fn(async () => invalidTaskResult()),
    start: vi.fn(async () => invalidTaskResult()),
    approve: vi.fn(async () => invalidTaskResult()),
    reject: vi.fn(async () => invalidTaskResult()),
    retry: vi.fn(async () => invalidTaskResult()),
    stop: vi.fn(async () => invalidTaskResult()),
    reopen: vi.fn(async () => invalidTaskResult()),
    delete: vi.fn(async () => invalidDeleteResult()),
    ...overrides,
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('TaskBoardController MVP synchronization', () => {
  it('installs snapshots and repairs an event gap with one authoritative refresh', async () => {
    const first = task(1)
    const repaired = task(2, 'review')
    const snapshot = vi
      .fn<TaskBoardRemote['snapshot']>()
      .mockResolvedValueOnce(snapshotResult(4, [first]))
      .mockResolvedValueOnce(snapshotResult(7, [first, repaired]))
    const controller = new TaskBoardController(remote({ snapshot }))

    expect(controller.getSnapshot()).toMatchObject({
      status: 'cold',
      boardRevision: 0,
      tasks: [],
    })
    await expect(controller.refresh()).resolves.toMatchObject({ ok: true })

    const gap: TaskBoardChange = {
      boardRevision: 7,
      operation: 'updated',
      taskId: repaired.id,
      task: repaired,
    }
    await controller.acceptChange(gap)

    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      boardRevision: 7,
      tasks: [first, repaired],
    })
  })

  it('forwards create-and-start and retries a failed task without a strategy argument', async () => {
    const failed = task(1, 'failed', 3)
    const created = task(2, 'running')
    const create = vi.fn<TaskBoardRemote['create']>(async () => taskResult(created))
    const retry = vi.fn<TaskBoardRemote['retry']>(async () => taskResult({
      ...failed,
      revision: 4,
      status: 'running',
    }))
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(1, [failed])),
      create,
      retry,
    }))
    await controller.refresh()

    const request: TaskBoardCreateRequest = {
      title: 'Ship board',
      description: 'Finish the board',
      acceptanceCriteria: 'Browser smoke passes',
      cwd: '/tmp/project',
      start: true,
    }
    await controller.create(request)
    await controller.retry(failed.id)

    expect(create).toHaveBeenCalledWith(request)
    expect(retry).toHaveBeenCalledWith({ id: failed.id, revision: 3 })
    expect(controller.getSnapshot().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: failed.id, status: 'running', revision: 4 }),
      created,
    ]))
  })

  it('suppresses duplicate UI actions while a mutation is pending and repairs conflicts', async () => {
    const initialized = task(1)
    const pending = deferred<RemoteResult<TaskBoardTaskResult>>()
    const start = vi.fn<TaskBoardRemote['start']>(() => pending.promise)
    const current = { ...initialized, revision: 4, title: 'Current title' }
    const edit = vi.fn<TaskBoardRemote['edit']>(async () => carried({
      ok: false,
      error: { code: 'revision-conflict', current },
    }))
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(1, [initialized])),
      start,
      edit,
    }))
    await controller.refresh()

    const starting = controller.start(initialized.id)
    expect(controller.getSnapshot().pendingTaskIds).toEqual([initialized.id])
    pending.resolve(taskResult({ ...initialized, revision: 2, status: 'running' }))
    await starting
    expect(controller.getSnapshot().pendingTaskIds).toEqual([])

    await expect(controller.edit(initialized.id, { title: 'Stale title' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision-conflict' },
    })
    expect(controller.getSnapshot().tasks).toContainEqual(current)
  })
})

describe('Task Board MVP UI', () => {
  it('renders five searchable columns and resolves only same-column drag ordering', () => {
    const tasks = [
      task(1),
      { ...task(2), title: 'Beta release' },
      task(3, 'running'),
      task(4, 'review'),
      task(5, 'done'),
      task(6, 'failed'),
    ]
    const onSelectTask = vi.fn()

    function Board(): JSX.Element {
      const [query, setQuery] = useState('')
      return (
        <TaskBoardView
          tasks={tasks}
          pendingTaskIds={[]}
          query={query}
          t={t}
          onCreate={() => {}}
          onQueryChange={setQuery}
          onSelectTask={onSelectTask}
          onReorder={async () => ({ ok: true, value: tasks[0]! })}
        />
      )
    }

    render(<Board />)

    for (const heading of ['初始化', '执行中', '待审核', '已完成', '失败']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    }
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索任务' }), {
      target: { value: 'beta' },
    })
    expect(screen.getByText('Beta release')).toBeTruthy()
    expect(screen.queryByText('Task 1')).toBeNull()
    fireEvent.click(screen.getByText('Beta release'))
    expect(onSelectTask).toHaveBeenCalledWith(tasks[1]!.id)

    expect(resolveTaskDrop(tasks, tasks[0]!.id, tasks[1]!.id)).toEqual({
      kind: 'reorder',
    })
    expect(resolveTaskDrop(
      tasks,
      tasks[0]!.id,
      `${TASK_BOARD_COLUMN_PREFIX}running`,
    )).toMatchObject({ kind: 'forbidden' })
  })

  it('creates a task with retained fields and an explicit start intent', async () => {
    const create = vi.fn(async (request: TaskBoardCreateRequest) => ({
      ok: true as const,
      value: { ...task(7, request.start ? 'running' : 'initialized'), ...request },
    }))
    const onClose = vi.fn()
    render(
      <CreateTaskDialog
        open
        creating={false}
        t={t}
        create={create}
        onClose={onClose}
      />,
    )

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Plugin MVP' } })
    fireEvent.change(screen.getByLabelText('任务描述'), { target: { value: 'Build the task board' } })
    fireEvent.change(screen.getByLabelText('验收标准'), { target: { value: 'Five columns work' } })
    fireEvent.change(screen.getByLabelText('工作目录（可选）'), { target: { value: ' /tmp/dsh ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并启动 Agent' }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        title: 'Plugin MVP',
        description: 'Build the task board',
        acceptanceCriteria: 'Five columns work',
        cwd: '/tmp/dsh',
        start: true,
      })
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByText('Agent Preset')).toBeNull()
  })

  it('exposes review decisions and compact linked round summaries', async () => {
    const round: TaskBoardRound = {
      id: 'round-1' as TaskBoardRound['id'],
      ordinal: 1,
      trigger: 'initial',
      status: 'completed',
      sessionId: 'session-1' as TaskBoardRound['sessionId'],
      rpcId: 'rpc-1' as TaskBoardRound['rpcId'],
      prompt: 'Complete Task 8.',
      startedAt: 1,
      endedAt: 2,
    }
    const reviewed = { ...task(8, 'review'), rounds: [round] }
    const approve = vi.fn(async () => success(reviewed))
    const reject = vi.fn(async () => success(reviewed))
    const openSession = vi.fn()
    render(
      <TaskDetail
        task={reviewed}
        pending={false}
        t={t}
        edit={vi.fn(async () => success(reviewed))}
        start={vi.fn(async () => success(reviewed))}
        approve={approve}
        reject={reject}
        retry={vi.fn(async () => success(reviewed))}
        stop={vi.fn(async () => success(reviewed))}
        reopen={vi.fn(async () => success(reviewed))}
        remove={vi.fn(async () => success({ deleted: true as const, taskId: reviewed.id }))}
        openSession={openSession}
        onClose={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    await waitFor(() => { expect(approve).toHaveBeenCalledWith(reviewed.id) })
    fireEvent.change(screen.getByLabelText('驳回反馈'), {
      target: { value: 'Add verification evidence' },
    })
    fireEvent.click(screen.getByRole('button', { name: '驳回并继续' }))
    await waitFor(() => {
      expect(reject).toHaveBeenCalledWith(reviewed.id, 'Add verification evidence')
    })
    fireEvent.click(screen.getByRole('button', { name: '打开 Session session-1' }))
    expect(openSession).toHaveBeenCalledWith(round.sessionId)
  })
})
