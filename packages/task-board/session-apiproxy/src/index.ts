/** One-entry Task Board composition using Host ApiProxy Sessions. @module @deepseek-ai/dsh-task-board-session-apiproxy */

import type { Context } from '@deepseek-ai/cordis'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import z from '@deepseek-ai/schemastery'
import TaskBoardService, {
  TaskBoardSessionService,
  type Config as TaskBoardConfig,
  type CreateTaskSessionRequest,
  type PromptTaskSessionRequest,
  type TaskBoardFailure,
  type TaskBoardSessionRequest,
  type TaskBoardSessionResult,
} from '@deepseek-ai/dsh-task-board'

function transportFailure(
  stage: TaskBoardFailure['stage'],
  message: string,
): TaskBoardSessionResult<never> {
  return {
    ok: false,
    failure: {
      stage,
      code: 'TRANSPORT_ERROR',
      message,
    },
  }
}

function rejected(
  stage: TaskBoardFailure['stage'],
  error: { readonly code: string; readonly message: string },
): TaskBoardSessionResult<never> {
  return {
    ok: false,
    failure: {
      stage,
      code: error.code,
      message: error.message,
    },
  }
}

/** Task Board Session provider backed by Host's ordinary ApiProxy methods. */
export class ApiProxyTaskBoardSessionProvider extends TaskBoardSessionService {
  static inject = ['apiProxy']

  /** @inheritdoc */
  async create(
    request: CreateTaskSessionRequest,
  ): Promise<TaskBoardSessionResult<{ readonly sessionId: CreateTaskSessionRequest['sessionId'] }>> {
    let response
    try {
      response = await this.ctx.apiProxy.sessions.create({
        rpcId: RpcId(request.requestId),
        payload: {
          sessionId: request.sessionId,
          ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        },
      })
    } catch {
      return transportFailure('session-create', 'Session could not be created.')
    }
    if (!response.result.ok) return rejected('session-create', response.result.error)
    return { ok: true, value: { sessionId: response.result.value.sessionId } }
  }

  /** @inheritdoc */
  async prompt(
    request: PromptTaskSessionRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>> {
    let response
    try {
      response = await this.ctx.apiProxy.sessions.prompt({
        rpcId: RpcId(request.requestId),
        payload: {
          sessionId: request.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: request.text }],
        },
      })
    } catch {
      return transportFailure('prompt-admission', 'Session prompt could not be admitted.')
    }
    if (!response.result.ok) return rejected('prompt-admission', response.result.error)
    return { ok: true, value: { accepted: true } }
  }

  /** @inheritdoc */
  async cancel(
    request: TaskBoardSessionRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>> {
    let response
    try {
      response = await this.ctx.apiProxy.sessions.cancel({
        rpcId: RpcId(request.requestId),
        payload: { sessionId: request.sessionId },
      })
    } catch {
      return transportFailure('execution', 'Session cancellation could not be admitted.')
    }
    if (!response.result.ok) return rejected('execution', response.result.error)
    return { ok: true, value: { accepted: true } }
  }
}

/** Stable Cordis plugin name. */
export const name = 'task-board'

/** ApiProxy must exist before the composition mounts its provider. */
export const inject = ['apiProxy']

/** User-facing Task Board configuration. */
export const Config = z.intersect([TaskBoardService.Config]) as z<Config>

/** User-facing Task Board configuration. */
export type Config = TaskBoardConfig

/**
 * Mount the internal Session provider and durable Task Board service as one Loader entry.
 * @param ctx - Host context carrying ApiProxy and Task Board dependencies.
 * @param config - validated Task Board text limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(ApiProxyTaskBoardSessionProvider)
  ctx.plugin(TaskBoardService, config)
}
