import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  TaskBoardChange,
  TaskBoardDeleteResult,
  TaskBoardSnapshotResult,
  TaskBoardTask,
  TaskBoardTaskId,
  TaskBoardTaskResult,
} from '@deepseek-ai/dsh-task-board/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  TaskBoardController,
  type TaskBoardRemote,
} from '../src/client/controller.ts'
import { apply, inject } from '../src/client/index.ts'
import type { TaskBoardInjected } from '../src/client/slots.ts'
import { TaskBoardLauncher } from '../src/client/TaskBoardLauncher.tsx'
import { TaskBoardOverlay } from '../src/client/TaskBoardOverlay.tsx'
import { apply as applyHost } from '../src/index.ts'

function task(revision = 1, status: TaskBoardTask['status'] = 'failed'): TaskBoardTask {
  return {
    id: 'task-1' as TaskBoardTaskId,
    sequence: 1,
    identifier: 'DSH-1',
    revision,
    title: 'Task 1',
    description: 'Requirement',
    acceptanceCriteria: 'Acceptance',
    status,
    position: '00000001',
    rounds: [],
    createdAt: 1,
    updatedAt: revision,
  }
}

function carried<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function snapshot(
  boardRevision: number,
  tasks: readonly TaskBoardTask[] = [],
): RemoteResult<TaskBoardSnapshotResult> {
  return carried({ ok: true, value: { boardRevision, tasks } })
}

function invalidTask(): RemoteResult<TaskBoardTaskResult> {
  return carried({
    ok: false,
    error: {
      code: 'invalid-transition',
      status: 'initialized',
      operation: 'test',
    },
  })
}

function invalidDelete(): RemoteResult<TaskBoardDeleteResult> {
  return carried({
    ok: false,
    error: {
      code: 'invalid-transition',
      status: 'initialized',
      operation: 'delete',
    },
  })
}

function taskBoardRemote(): TaskBoardRemote {
  const invalid = vi.fn(async () => invalidTask())
  return {
    snapshot: vi.fn(async () => snapshot(1, [task()])),
    create: vi.fn(invalid),
    edit: vi.fn(invalid),
    reorder: vi.fn(invalid),
    start: vi.fn(invalid),
    approve: vi.fn(invalid),
    reject: vi.fn(invalid),
    retry: vi.fn(async () => carried({ ok: true as const, value: task(2, 'running') })),
    stop: vi.fn(invalid),
    reopen: vi.fn(invalid),
    delete: vi.fn(async () => invalidDelete()),
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const forwarded = new TestRemote(ctx) as TestRemote & { taskBoard: TaskBoardRemote }
  forwarded.taskBoard = taskBoardRemote()
  ctx.provide('remote.taskBoard', forwarded.taskBoard)
  const sessions = { open: vi.fn() }
  ctx.provide('sessions', sessions as never)

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, forwarded, sessions, slots }
}

describe('ui-task-board browser plugin', () => {
  it('declares only the Client services used by the MVP', () => {
    expect(inject).toEqual([
      'slots',
      'locale',
      'remote',
      'remote.taskBoard',
      'sessions',
    ])
    expect(() => { applyHost() }).not.toThrow()
  })

  it('registers one launcher and overlay backed by a shared controller and store', async () => {
    const b = await bench()
    const launcher = b.slots.entries('sidebar.footer.action')[0]
    const overlay = b.slots.entries('shell.overlay')[0]
    expect(launcher?.component).toBe(TaskBoardLauncher)
    expect(overlay?.component).toBe(TaskBoardOverlay)
    expect(launcher?.store).toBeDefined()
    expect(launcher?.store).toBe(overlay?.store)
    expect(launcher?.locale).toBe('taskBoard')
    expect(overlay?.locale).toBe('taskBoard')

    const launcherFace = launcher?.inject?.() as unknown as TaskBoardInjected
    const overlayFace = overlay?.inject?.() as unknown as TaskBoardInjected
    expect(launcherFace.hooks.board).toBeInstanceOf(TaskBoardController)
    expect(launcherFace.hooks.board).toBe(overlayFace.hooks.board)

    await overlayFace.refresh()
    await overlayFace.retry(task().id)
    overlayFace.openSession('session-1' as SessionId)
    expect(b.forwarded.taskBoard.retry).toHaveBeenCalledWith({ id: task().id, revision: 1 })
    expect(b.sessions.open).toHaveBeenCalledWith('session-1')
  })

  it('applies exact changes and repairs revision gaps and connection resets', async () => {
    const b = await bench()
    const face = b.slots.entries('shell.overlay')[0]!.inject?.() as unknown as TaskBoardInjected
    const read = vi.mocked(b.forwarded.taskBoard.snapshot)
    await face.refresh()

    const updated = task(2, 'review')
    const next: TaskBoardChange = {
      boardRevision: 2,
      operation: 'updated',
      taskId: updated.id,
      task: updated,
    }
    b.forwarded.$dispatch('task-board/changed', [next])
    expect(face.hooks.board.getSnapshot()).toMatchObject({
      boardRevision: 2,
      tasks: [updated],
    })

    read.mockResolvedValueOnce(snapshot(4, [updated]))
    b.forwarded.$dispatch('task-board/changed', [{
      boardRevision: 4,
      operation: 'deleted',
      taskId: updated.id,
    } satisfies TaskBoardChange])
    await vi.waitFor(() => {
      expect(face.hooks.board.getSnapshot().boardRevision).toBe(4)
    })

    read.mockResolvedValueOnce(snapshot(5, []))
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => {
      expect(face.hooks.board.getSnapshot().boardRevision).toBe(5)
    })
  })

  it('withdraws both slot contributions on plugin disposal', async () => {
    const b = await bench()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
    await b.fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
  })
})
