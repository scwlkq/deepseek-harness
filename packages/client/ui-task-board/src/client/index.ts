/** Task-board browser plugin registrations. @module @deepseek-ai/dsh-client-ui-task-board/client */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { TaskBoardController } from './controller.ts'
import { TaskBoardLauncher } from './TaskBoardLauncher.tsx'
import { TaskBoardOverlay } from './TaskBoardOverlay.tsx'
import { en, NS, zh } from './locales.ts'
import type { TaskBoardInjected } from './slots.ts'
import { createTaskBoardStore } from './store.ts'

export type {
  TaskBoardClientResult,
  TaskBoardClientStatus,
  TaskBoardClientView,
  TaskBoardRemote,
} from './controller.ts'
export type {
  TaskBoardInjected,
  TaskBoardLauncherProps,
  TaskBoardOverlayProps,
} from './slots.ts'
export type { TaskBoardUiState } from './store.ts'
export { TaskBoardController, taskBoardErrorMessage } from './controller.ts'
export { TaskBoardLauncher } from './TaskBoardLauncher.tsx'
export { TaskBoardOverlay } from './TaskBoardOverlay.tsx'
export { createTaskBoardStore } from './store.ts'

/** Client services required by the task-board browser plugin. */
export const inject = ['slots', 'locale', 'remote', 'remote.taskBoard', 'sessions']

/**
 * Register one shared controller and store in the sidebar and overlay slots.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new TaskBoardController(ctx.remote.taskBoard)
  const store = createTaskBoardStore()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-board: dictionaries')
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('task-board/changed', (change) => { void controller.acceptChange(change) }),
      ctx.on('connection/reset', () => { void controller.connectionReset() }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      controller.dispose()
    }
  }, 'ui-task-board: synchronization')

  const injected = (): TaskBoardInjected => ({
    hooks: { board: controller },
    refresh: () => controller.refresh(),
    create: request => controller.create(request),
    edit: (taskId, patch) => controller.edit(taskId, patch),
    reorder: (taskId, beforeTaskId) => controller.reorder(taskId, beforeTaskId),
    start: taskId => controller.start(taskId),
    approve: taskId => controller.approve(taskId),
    reject: (taskId, feedback) => controller.reject(taskId, feedback),
    retry: taskId => controller.retry(taskId),
    stop: taskId => controller.stop(taskId),
    reopen: taskId => controller.reopen(taskId),
    delete: taskId => controller.delete(taskId),
    openSession: (sessionId) => { ctx.sessions.open(sessionId) },
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'task-board',
    order: -20,
    locale: NS,
    store,
    inject: injected,
  }, TaskBoardLauncher))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'task-board',
    order: 0,
    locale: NS,
    store,
    inject: injected,
  }, TaskBoardOverlay))
}
