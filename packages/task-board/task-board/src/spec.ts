/** Durable task-board Storage Domain declaration. @module @deepseek-ai/dsh-task-board/src/spec */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { domainTable, defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  TaskBoardFailure,
  TaskBoardRound,
  TaskBoardRoundId,
  TaskBoardRpcId,
  TaskBoardTask,
  TaskBoardTaskId,
} from './types.ts'

const nonNegativeInteger = z.number().int().nonnegative()
const positiveInteger = z.number().int().positive()
const taskIdSchema = z.string().min(1).transform(value => value as TaskBoardTaskId)
const roundIdSchema = z.string().min(1).transform(value => value as TaskBoardRoundId)
const rpcIdSchema = z.string().min(1).transform(value => value as TaskBoardRpcId)
const sessionIdSchema = z.string().min(1).transform(value => value as SessionId)

/** Stable user-safe failure persisted on a terminal task round. */
export const taskBoardFailureSchema: z.ZodType<TaskBoardFailure> = z.object({
  stage: z.enum(['session-create', 'prompt-admission', 'execution', 'recovery']),
  code: z.string().min(1),
  message: z.string().min(1),
  turn: nonNegativeInteger.optional(),
  seq: nonNegativeInteger.optional(),
}).strict()

/** One compact durable execution-round validator. */
export const taskBoardRoundSchema: z.ZodType<TaskBoardRound> = z.object({
  id: roundIdSchema,
  ordinal: positiveInteger,
  trigger: z.enum(['initial', 'revision', 'retry']),
  status: z.enum(['starting', 'running', 'completed', 'failed', 'cancelled']),
  sessionId: sessionIdSchema,
  rpcId: rpcIdSchema,
  prompt: z.string().min(1),
  startedAt: nonNegativeInteger,
  acceptedAt: nonNegativeInteger.optional(),
  messageSeq: nonNegativeInteger.optional(),
  turn: nonNegativeInteger.optional(),
  startSeq: nonNegativeInteger.optional(),
  turnEndSeq: nonNegativeInteger.optional(),
  endSeq: nonNegativeInteger.optional(),
  endedAt: nonNegativeInteger.optional(),
  feedback: z.string().min(1).optional(),
  failure: taskBoardFailureSchema.optional(),
}).strict()

/** Durable task-card validator used on every Storage Domain read and write. */
export const taskBoardTaskSchema: z.ZodType<TaskBoardTask> = z.object({
  id: taskIdSchema,
  sequence: positiveInteger,
  identifier: z.string().min(1),
  revision: nonNegativeInteger,
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.string(),
  status: z.enum(['initialized', 'running', 'review', 'done', 'failed']),
  position: z.string().regex(/^\d+$/),
  cwd: z.string().min(1).optional(),
  rounds: z.array(taskBoardRoundSchema),
  createdAt: nonNegativeInteger,
  updatedAt: nonNegativeInteger,
  completedAt: nonNegativeInteger.optional(),
}).strict()

/** Global allocation and browser-repair revision stored with the domain. */
export const taskBoardGlobalSchema = z.object({
  nextSequence: positiveInteger,
  boardRevision: nonNegativeInteger,
}).strict()

/** Durable global task-board record. */
export type TaskBoardGlobal = z.infer<typeof taskBoardGlobalSchema>

/** Task-board Storage Domain version zero with one task table. */
export const taskBoardDomainSpec = defineDomain({
  name: 'task_board',
  version: 0,
  global: {
    schema: taskBoardGlobalSchema,
    initial: { nextSequence: 1, boardRevision: 0 },
  },
  tables: {
    tasks: domainTable<TaskBoardTaskId, TaskBoardTask>(taskBoardTaskSchema),
  },
})
