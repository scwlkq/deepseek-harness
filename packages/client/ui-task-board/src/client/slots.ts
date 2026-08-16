/** Slot faces for the task-board launcher and overlay. @module @deepseek-ai/dsh-client-ui-task-board/client/slots */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRuntime,
  PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  TaskBoardCreateRequest,
  TaskBoardDeleteValue,
  TaskBoardEditPatch,
  TaskBoardTask,
  TaskBoardTaskId,
} from '@deepseek-ai/dsh-task-board/types'
import type {
  TaskBoardClientResult,
  TaskBoardClientView,
} from './controller.ts'
import type { NS } from './locales.ts'
import type { createTaskBoardStore } from './store.ts'

/** Business callbacks and authoritative projection shared by both entries. */
export interface TaskBoardInjected {
  hooks: {
    /** Authoritative task projection synchronized from Host. */
    board: HostObservable<TaskBoardClientView>
  }
  refresh: () => Promise<TaskBoardClientResult<readonly TaskBoardTask[]>>
  create: (request: TaskBoardCreateRequest) => Promise<TaskBoardClientResult<TaskBoardTask>>
  edit: (
    taskId: TaskBoardTaskId,
    patch: TaskBoardEditPatch,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
  reorder: (
    taskId: TaskBoardTaskId,
    beforeTaskId?: TaskBoardTaskId,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
  start: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  approve: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  reject: (
    taskId: TaskBoardTaskId,
    feedback: string,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
  retry: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  stop: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  reopen: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  delete: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardDeleteValue>>
  openSession: (sessionId: SessionId) => void
}

/** Sidebar footer launcher props. */
export type TaskBoardLauncherProps =
  & PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createTaskBoardStore>>
  & InjectFace<TaskBoardInjected>
  & PropsLocale<typeof NS>

/** Full-frame overlay props. */
export type TaskBoardOverlayProps =
  & PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createTaskBoardStore>>
  & InjectFace<TaskBoardInjected>
  & PropsLocale<typeof NS>
