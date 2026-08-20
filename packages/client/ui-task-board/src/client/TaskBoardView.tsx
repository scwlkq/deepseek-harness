/** Searchable five-column task-board. */

import { useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import {
  IconPlusOutline16,
  IconSearchOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '@deepseek-ai/dsh-task-board/types'
import {
  taskBoardErrorMessage,
  type TaskBoardClientResult,
} from './controller.ts'
import { resolveTaskDrop, TASK_BOARD_COLUMN_PREFIX } from './drag.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './TaskBoard.module.css'

/** Stable five-state column order. */
export const TASK_BOARD_STATUSES: readonly TaskBoardStatus[] = [
  'initialized',
  'running',
  'review',
  'done',
  'failed',
]

/** Props for the searchable five-column board. */
export interface TaskBoardViewProps {
  readonly tasks: readonly TaskBoardTask[]
  readonly pendingTaskIds: readonly TaskBoardTaskId[]
  readonly query: string
  readonly t: TaskBoardOverlayProps['t']
  readonly onCreate: () => void
  readonly onQueryChange: (query: string) => void
  readonly onSelectTask: (taskId: TaskBoardTaskId) => void
  readonly onReorder: (
    taskId: TaskBoardTaskId,
    beforeTaskId?: TaskBoardTaskId,
  ) => Promise<TaskBoardClientResult<TaskBoardTask>>
}

function statusLabel(status: TaskBoardStatus, t: TaskBoardOverlayProps['t']): string {
  return t(`status.${status}`)
}

function matches(task: TaskBoardTask, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return true
  return [
    task.identifier,
    task.title,
    task.description,
    task.acceptanceCriteria,
    task.cwd ?? '',
  ].some(value => value.toLocaleLowerCase().includes(normalized))
}

function latestFailure(task: TaskBoardTask): string | undefined {
  return task.rounds.at(-1)?.failure?.message
}

function TaskCard({
  task,
  pending,
  t,
  onSelect,
}: {
  readonly task: TaskBoardTask
  readonly pending: boolean
  readonly t: TaskBoardOverlayProps['t']
  readonly onSelect: () => void
}) {
  const sortable = useSortable({ id: task.id, disabled: pending })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  const failure = latestFailure(task)

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className={clsx(css.taskCard, sortable.isDragging && css.taskCardDragging)}
      data-status={task.status}
      aria-busy={pending || undefined}
    >
      <button
        ref={sortable.setActivatorNodeRef}
        type="button"
        className={css.taskCardButton}
        onClick={onSelect}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <span className={css.cardTopline}>
          <span className={css.identifier}>{task.identifier}</span>
          {pending ? <span className={css.pending}>{t('card.pending')}</span> : null}
        </span>
        <strong>{task.title}</strong>
        {task.description === '' ? null : <p>{task.description}</p>}
        <span className={css.cardMeta}>
          <span>{t('card.rounds', { count: task.rounds.length })}</span>
          {task.cwd === undefined ? null : <span title={task.cwd}>{t('card.cwd')}</span>}
        </span>
        {failure === undefined ? null : (
          <span className={css.cardFailure}>{failure}</span>
        )}
      </button>
    </article>
  )
}

function BoardColumn({
  status,
  tasks,
  pendingTaskIds,
  t,
  onSelectTask,
}: {
  readonly status: TaskBoardStatus
  readonly tasks: readonly TaskBoardTask[]
  readonly pendingTaskIds: ReadonlySet<TaskBoardTaskId>
  readonly t: TaskBoardOverlayProps['t']
  readonly onSelectTask: (taskId: TaskBoardTaskId) => void
}) {
  const columnId = `${TASK_BOARD_COLUMN_PREFIX}${status}`
  const droppable = useDroppable({ id: columnId })
  return (
    <section
      ref={droppable.setNodeRef}
      className={clsx(css.boardColumn, droppable.isOver && css.boardColumnOver)}
      data-status={status}
    >
      <header className={css.columnHeader}>
        <span className={css.statusDot} aria-hidden="true" />
        <h2>{statusLabel(status, t)}</h2>
        <span className={css.columnCount}>{tasks.length}</span>
      </header>
      <SortableContext items={tasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
        <div className={css.cardList}>
          {tasks.length === 0 ? <p className={css.emptyColumn}>{t('column.empty')}</p> : null}
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              pending={pendingTaskIds.has(task.id)}
              t={t}
              onSelect={() => { onSelectTask(task.id) }}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  )
}

/**
 * Render searchable cards in five workflow columns with same-column ordering.
 * @param props - authoritative tasks and presentation actions.
 * @returns task-board toolbar and columns.
 */
export function TaskBoardView({
  tasks,
  pendingTaskIds,
  query,
  t,
  onCreate,
  onQueryChange,
  onSelectTask,
  onReorder,
}: TaskBoardViewProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [dragFailure, setDragFailure] = useState<string | null>(null)
  const pending = useMemo(() => new Set(pendingTaskIds), [pendingTaskIds])
  const visible = useMemo(() => tasks.filter(task => matches(task, query)), [query, tasks])

  const handleDragEnd = (event: DragEndEvent): void => {
    if (event.over === null) return
    const activeId = event.active.id as TaskBoardTaskId
    const resolution = resolveTaskDrop(tasks, activeId, String(event.over.id))
    if (resolution.kind === 'forbidden') {
      setDragFailure(t('drag.forbidden'))
      return
    }
    if (resolution.kind !== 'reorder') return
    setDragFailure(null)
    void onReorder(activeId, resolution.beforeTaskId).then((result) => {
      if (!result.ok) setDragFailure(taskBoardErrorMessage(result.error))
    })
  }

  return (
    <div className={css.boardRoot}>
      <div className={css.boardToolbar}>
        <button type="button" className={css.newTaskButton} onClick={onCreate}>
          <IconPlusOutline16 />
          {t('board.new')}
        </button>
        <Input
          type="search"
          role="searchbox"
          aria-label={t('board.search.aria')}
          placeholder={t('board.search')}
          value={query}
          icon={<IconSearchOutline16 />}
          className={css.search as string}
          onChange={(event) => { onQueryChange(event.currentTarget.value) }}
        />
        <span className={css.taskTotal}>{t('board.total', { count: visible.length })}</span>
      </div>
      {dragFailure === null ? null : <p className={css.dragFailure}>{dragFailure}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className={css.columns}>
          {TASK_BOARD_STATUSES.map(status => (
            <BoardColumn
              key={status}
              status={status}
              tasks={visible.filter(task => task.status === status)}
              pendingTaskIds={pending}
              t={t}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
