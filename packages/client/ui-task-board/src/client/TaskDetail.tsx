/** Task detail and workflow actions. */

import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  TaskBoardDeleteValue,
  TaskBoardEditPatch,
  TaskBoardTask,
  TaskBoardTaskId,
} from '@deepseek-ai/dsh-task-board/types'
import {
  taskBoardErrorMessage,
  type TaskBoardClientResult,
} from './controller.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './TaskBoard.module.css'

/** Props for one selected task detail modal. */
export interface TaskDetailProps {
  readonly task: TaskBoardTask
  readonly pending: boolean
  readonly t: TaskBoardOverlayProps['t']
  readonly edit: (
    id: TaskBoardTaskId,
    patch: TaskBoardEditPatch,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly start: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly approve: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly reject: (
    id: TaskBoardTaskId,
    feedback: string,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly retry: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly stop: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly reopen: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly remove: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardDeleteValue>>
  readonly openSession: TaskBoardOverlayProps['openSession']
  readonly onClose: () => void
}

/**
 * Render retained task fields, valid workflow actions and compact round summaries.
 * @param props - selected task and authoritative Host actions.
 * @returns task detail modal.
 */
export function TaskDetail({
  task,
  pending,
  t,
  edit,
  start,
  approve,
  reject,
  retry,
  stop,
  reopen,
  remove,
  openSession,
  onClose,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(task.acceptanceCriteria)
  const [cwd, setCwd] = useState(task.cwd ?? '')
  const [feedback, setFeedback] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description)
    setAcceptanceCriteria(task.acceptanceCriteria)
    setCwd(task.cwd ?? '')
    setFailure(null)
  }, [task])

  const run = async <T,>(operation: () => Promise<TaskBoardClientResult<T>>): Promise<boolean> => {
    setActing(true)
    setFailure(null)
    try {
      const result = await operation()
      if (!result.ok) {
        setFailure(taskBoardErrorMessage(result.error))
        return false
      }
      return true
    } finally {
      setActing(false)
    }
  }

  const save = (): void => {
    const patch: TaskBoardEditPatch = {
      title: title.trim(),
      description: description.trim(),
      acceptanceCriteria: acceptanceCriteria.trim(),
      cwd: cwd.trim() === '' ? null : cwd.trim(),
    }
    void run(() => edit(task.id, patch))
  }

  const rejectTask = (): void => {
    const normalized = feedback.trim()
    if (normalized === '') {
      setFailure(t('detail.reject.required'))
      return
    }
    void run(() => reject(task.id, normalized)).then((ok) => {
      if (ok) setFeedback('')
    })
  }

  const deleteTask = (): void => {
    if (task.status !== 'initialized' && !window.confirm(t('detail.delete.confirm'))) return
    void run(() => remove(task.id)).then((ok) => {
      if (ok) onClose()
    })
  }

  const disabled = pending || acting
  const editable = task.status !== 'running'
  return (
    <Modal
      open
      onClose={onClose}
      title={task.title}
      closeLabel={t('detail.close')}
      className={css.detailDialog as string}
    >
      <div className={css.detailLayout}>
        <div className={css.detailMain}>
          <div className={css.detailIdentity}>
            <span>{task.identifier}</span>
            <span className={css.statusPill} data-status={task.status}>{t(`status.${task.status}`)}</span>
          </div>
          <div className={css.detailFields}>
            <label>
              <span>{t('create.title.label')}</span>
              <input
                value={title}
                disabled={!editable || disabled}
                onChange={(event) => { setTitle(event.currentTarget.value) }}
              />
            </label>
            <label>
              <span>{t('create.description.label')}</span>
              <textarea
                value={description}
                disabled={!editable || disabled}
                rows={5}
                onChange={(event) => { setDescription(event.currentTarget.value) }}
              />
            </label>
            <label>
              <span>{t('create.criteria.label')}</span>
              <textarea
                value={acceptanceCriteria}
                disabled={!editable || disabled}
                rows={4}
                onChange={(event) => { setAcceptanceCriteria(event.currentTarget.value) }}
              />
            </label>
            <label>
              <span>{t('create.cwd.label')}</span>
              <input
                value={cwd}
                disabled={!editable || disabled}
                onChange={(event) => { setCwd(event.currentTarget.value) }}
              />
            </label>
          </div>
          <div className={css.workflowActions}>
            {editable ? (
              <Button variant="outline" disabled={disabled} onClick={save}>{t('detail.save')}</Button>
            ) : null}
            {task.status === 'initialized' ? (
              <Button variant="primary" disabled={disabled} onClick={() => { void run(() => start(task.id)) }}>
                {t('detail.start')}
              </Button>
            ) : null}
            {task.status === 'running' ? (
              <Button variant="outline" disabled={disabled} onClick={() => { void run(() => stop(task.id)) }}>
                {t('detail.stop')}
              </Button>
            ) : null}
            {task.status === 'review' ? (
              <Button variant="primary" disabled={disabled} onClick={() => { void run(() => approve(task.id)) }}>
                {t('detail.approve')}
              </Button>
            ) : null}
            {task.status === 'failed' ? (
              <Button variant="primary" disabled={disabled} onClick={() => { void run(() => retry(task.id)) }}>
                {t('detail.retry')}
              </Button>
            ) : null}
            {task.status === 'done' ? (
              <Button variant="outline" disabled={disabled} onClick={() => { void run(() => reopen(task.id)) }}>
                {t('detail.reopen')}
              </Button>
            ) : null}
            {task.status === 'running' ? null : (
              <Button className={css.deleteButton as string} disabled={disabled} onClick={deleteTask}>
                {t('detail.delete')}
              </Button>
            )}
          </div>
          {task.status === 'review' ? (
            <div className={css.reviewBox}>
              <label>
                <span>{t('detail.reject.label')}</span>
                <textarea
                  value={feedback}
                  aria-label={t('detail.reject.label')}
                  rows={3}
                  placeholder={t('detail.reject.placeholder')}
                  disabled={disabled}
                  onChange={(event) => { setFeedback(event.currentTarget.value) }}
                />
              </label>
              <Button variant="outline" disabled={disabled} onClick={rejectTask}>
                {t('detail.reject')}
              </Button>
            </div>
          ) : null}
          {failure === null ? null : <p className={css.inlineFailure}>{failure}</p>}
        </div>
        <aside className={css.roundRail}>
          <h3>{t('detail.rounds')}</h3>
          {task.rounds.length === 0 ? <p className={css.noRounds}>{t('detail.rounds.empty')}</p> : null}
          {task.rounds.map(round => (
            <article key={round.id} className={css.roundCard}>
              <div>
                <strong>{t('detail.round', { ordinal: round.ordinal })}</strong>
                <span>{t(`round.status.${round.status}`)}</span>
              </div>
              <span>{t(`round.trigger.${round.trigger}`)}</span>
              <button
                type="button"
                aria-label={t('detail.openSession', { id: round.sessionId })}
                title={round.sessionId}
                onClick={() => { openSession(round.sessionId) }}
              >
                {round.sessionId}
              </button>
              {round.feedback === undefined ? null : <p>{round.feedback}</p>}
              {round.failure === undefined ? null : <p className={css.roundFailure}>{round.failure.message}</p>}
            </article>
          ))}
        </aside>
      </div>
    </Modal>
  )
}
