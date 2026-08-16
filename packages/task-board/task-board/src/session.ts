/** Provider-neutral Session admission used by Task Board. @module @deepseek-ai/dsh-task-board/session */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardFailure, TaskBoardRpcId } from './types.ts'

/** Result of one Task Board Session operation. */
export type TaskBoardSessionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: TaskBoardFailure }

/** Request shared by Session operations. */
export interface TaskBoardSessionRequest {
  readonly requestId: TaskBoardRpcId
  readonly sessionId: SessionId
}

/** Request a fresh board-owned Session. */
export interface CreateTaskSessionRequest extends TaskBoardSessionRequest {
  readonly cwd?: string
}

/** Request one ordinary text prompt. */
export interface PromptTaskSessionRequest extends TaskBoardSessionRequest {
  readonly text: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session admission provider used by Task Board execution. */
    taskBoardSession: TaskBoardSessionService
  }
}

/** Provider-neutral Session operations required by Task Board. */
export abstract class TaskBoardSessionService extends Service {
  /** @param ctx - Cordis context owning the provider. */
  constructor(ctx: Context) {
    super(ctx, 'taskBoardSession')
  }

  /**
   * Create one Session using the deployment's default Agent Preset.
   * @param request - reserved identity and optional working directory.
   * @returns Session creation result.
   */
  abstract create(
    request: CreateTaskSessionRequest,
  ): Promise<TaskBoardSessionResult<{ readonly sessionId: SessionId }>>

  /**
   * Queue one ordinary user prompt in a board-owned Session.
   * @param request - Session identity, correlation identity and text.
   * @returns prompt admission result.
   */
  abstract prompt(
    request: PromptTaskSessionRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>>

  /**
   * Cancel the active turn of a board-owned Session.
   * @param request - Session and correlation identities.
   * @returns cancellation admission result.
   */
  abstract cancel(
    request: TaskBoardSessionRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>>
}
