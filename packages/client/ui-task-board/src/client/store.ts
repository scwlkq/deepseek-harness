/** Shared task-board presentation state. @module @deepseek-ai/dsh-client-ui-task-board/client/store */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskBoardStatus, TaskBoardTaskId } from '@deepseek-ai/dsh-task-board/types'

/** Root-scoped state shared by the launcher and overlay. */
export interface TaskBoardUiState {
  open: boolean
  createOpen: boolean
  createStatusHint: TaskBoardStatus | null
  selectedTaskId: TaskBoardTaskId | null
  query: string
}

type TaskBoardUiActions = {
  open: (draft: TaskBoardUiState) => void
  close: (draft: TaskBoardUiState) => void
  openCreate: (draft: TaskBoardUiState, statusHint?: TaskBoardStatus) => void
  closeCreate: (draft: TaskBoardUiState) => void
  selectTask: (draft: TaskBoardUiState, taskId: TaskBoardTaskId | null) => void
  setQuery: (draft: TaskBoardUiState, query: string) => void
}

/**
 * Create one root-scoped task-board store handle.
 * @returns fresh store definition shared by both slot entries.
 */
export function createTaskBoardStore(): EngineStoreHandle<TaskBoardUiState, TaskBoardUiActions> {
  return defineStore({
    init: (): TaskBoardUiState => ({
      open: false,
      createOpen: false,
      createStatusHint: null,
      selectedTaskId: null,
      query: '',
    }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => {
        draft.open = false
        draft.createOpen = false
        draft.createStatusHint = null
        draft.selectedTaskId = null
      },
      openCreate: (draft, statusHint) => {
        draft.createOpen = true
        draft.createStatusHint = statusHint ?? null
      },
      closeCreate: (draft) => {
        draft.createOpen = false
        draft.createStatusHint = null
      },
      selectTask: (draft, taskId) => { draft.selectedTaskId = taskId },
      setQuery: (draft, query) => { draft.query = query },
    },
  })
}
