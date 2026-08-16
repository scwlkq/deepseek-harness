/** Task creation dialog for retained MVP fields. */

import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  TaskBoardCreateRequest,
  TaskBoardTask,
} from '@deepseek-ai/dsh-task-board/types'
import {
  taskBoardErrorMessage,
  type TaskBoardClientResult,
} from './controller.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './TaskBoard.module.css'

/** Props for the controlled task creation dialog. */
export interface CreateTaskDialogProps {
  readonly open: boolean
  readonly creating: boolean
  readonly t: TaskBoardOverlayProps['t']
  readonly create: (
    request: TaskBoardCreateRequest,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly onClose: () => void
}

/**
 * Create one durable card, optionally starting its first Agent Session.
 * @param props - controlled visibility and Host create action.
 * @returns task creation modal.
 */
export function CreateTaskDialog({
  open,
  creating,
  t,
  create,
  onClose,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [cwd, setCwd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setAcceptanceCriteria('')
    setCwd('')
    setFailure(null)
  }, [open])

  const submit = async (start: boolean): Promise<void> => {
    const normalizedDescription = description.trim()
    const normalizedCriteria = acceptanceCriteria.trim()
    if (normalizedDescription.length === 0 && normalizedCriteria.length === 0) {
      setFailure(t('create.validation'))
      return
    }

    const normalizedTitle = title.trim()
    const normalizedCwd = cwd.trim()
    const request: TaskBoardCreateRequest = {
      ...(normalizedTitle === '' ? {} : { title: normalizedTitle }),
      description: normalizedDescription,
      acceptanceCriteria: normalizedCriteria,
      ...(normalizedCwd === '' ? {} : { cwd: normalizedCwd }),
      start,
    }
    setSubmitting(true)
    setFailure(null)
    try {
      const result = await create(request)
      if (!result.ok) {
        setFailure(taskBoardErrorMessage(result.error))
        return
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = creating || submitting
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('create.title')}
      closeLabel={t('create.close')}
      description={t('create.description')}
      className={css.createDialog as string}
      footer={(
        <div className={css.dialogActions}>
          <Button disabled={disabled} onClick={onClose}>{t('create.cancel')}</Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => { void submit(false) }}
          >
            {t('create.only')}
          </Button>
          <Button
            variant="primary"
            disabled={disabled}
            onClick={() => { void submit(true) }}
          >
            {disabled ? t('create.saving') : t('create.start')}
          </Button>
        </div>
      )}
    >
      <div className={css.dialogFields}>
        <label>
          <span>{t('create.title.label')}</span>
          <input
            value={title}
            aria-label={t('create.title.label')}
            autoFocus
            onChange={(event) => { setTitle(event.currentTarget.value) }}
          />
        </label>
        <label>
          <span>{t('create.description.label')}</span>
          <textarea
            value={description}
            aria-label={t('create.description.label')}
            rows={4}
            onChange={(event) => { setDescription(event.currentTarget.value) }}
          />
        </label>
        <label>
          <span>{t('create.criteria.label')}</span>
          <textarea
            value={acceptanceCriteria}
            aria-label={t('create.criteria.label')}
            rows={3}
            onChange={(event) => { setAcceptanceCriteria(event.currentTarget.value) }}
          />
        </label>
        <label>
          <span>{t('create.cwd.label')}</span>
          <input
            value={cwd}
            aria-label={t('create.cwd.label')}
            placeholder="/path/to/project"
            onChange={(event) => { setCwd(event.currentTarget.value) }}
          />
        </label>
        {failure === null ? null : <p className={css.inlineFailure}>{failure}</p>}
      </div>
    </Modal>
  )
}
