/** Full-frame task-board overlay. */

import { useEffect } from 'react'
import {
  IconCloseOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CreateTaskDialog } from './CreateTaskDialog.tsx'
import { taskBoardErrorMessage } from './controller.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import { TaskBoardView } from './TaskBoardView.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import css from './TaskBoard.module.css'

/**
 * Render the root task-board surface while its shared store is open.
 * @param props - slot runtime, shared store and Host-backed task actions.
 * @returns full-frame overlay or null while closed.
 */
export function TaskBoardOverlay({
  useStore,
  actions,
  useBoard,
  refresh,
  create,
  edit,
  reorder,
  start,
  approve,
  reject,
  retry,
  stop,
  reopen,
  delete: deleteTask,
  openSession,
  t,
}: TaskBoardOverlayProps) {
  const open = useStore(state => state.open)
  const createOpen = useStore(state => state.createOpen)
  const selectedTaskId = useStore(state => state.selectedTaskId)
  const query = useStore(state => state.query)
  const board = useBoard(view => view)
  const selectedTask = selectedTaskId === null
    ? undefined
    : board.tasks.find(task => task.id === selectedTaskId)

  useEffect(() => {
    if (open && (board.status === 'cold' || board.status === 'error')) void refresh()
  }, [board.status, open, refresh])

  useEffect(() => {
    if (selectedTaskId !== null && board.status === 'ready' && selectedTask === undefined) {
      actions.selectTask(null)
    }
  }, [actions, board.status, selectedTask, selectedTaskId])

  if (!open) return null
  return (
    <section className={css.overlay} aria-label={t('board.title')}>
      <header className={css.overlayHeader}>
        <div>
          <h1>{t('board.title')}</h1>
          <p>{t('board.subtitle')}</p>
        </div>
        <div className={css.overlayActions}>
          <span>{t('board.revision', { revision: board.boardRevision })}</span>
          <button
            type="button"
            aria-label={t('board.refresh')}
            title={t('board.refresh')}
            disabled={board.status === 'loading'}
            onClick={() => { void refresh() }}
          >
            <IconRefreshOutline16 />
          </button>
          <button
            type="button"
            aria-label={t('board.close')}
            title={t('board.close')}
            onClick={() => { actions.close() }}
          >
            <IconCloseOutline16 />
          </button>
        </div>
      </header>
      {board.status === 'loading' && board.tasks.length === 0
        ? <p className={css.boardNotice}>{t('board.loading')}</p>
        : null}
      {board.error === null
        ? null
        : <p className={css.boardError}>{t('board.error')}: {taskBoardErrorMessage(board.error)}</p>}
      <TaskBoardView
        tasks={board.tasks}
        pendingTaskIds={board.pendingTaskIds}
        query={query}
        t={t}
        onCreate={() => { actions.openCreate() }}
        onQueryChange={(value) => { actions.setQuery(value) }}
        onSelectTask={(taskId) => { actions.selectTask(taskId) }}
        onReorder={reorder}
      />
      <CreateTaskDialog
        open={createOpen}
        creating={board.creating}
        t={t}
        create={create}
        onClose={() => { actions.closeCreate() }}
      />
      {selectedTask === undefined ? null : (
        <TaskDetail
          task={selectedTask}
          pending={board.pendingTaskIds.includes(selectedTask.id)}
          t={t}
          edit={edit}
          start={start}
          approve={approve}
          reject={reject}
          retry={retry}
          stop={stop}
          reopen={reopen}
          remove={deleteTask}
          openSession={openSession}
          onClose={() => { actions.selectTask(null) }}
        />
      )}
    </section>
  )
}
