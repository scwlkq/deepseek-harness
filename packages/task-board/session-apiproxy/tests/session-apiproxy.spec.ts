import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { RpcId, type ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskBoardRpcId } from '@deepseek-ai/dsh-task-board'
import { ApiProxyTaskBoardSessionProvider } from '../src/index.ts'

function requestId(value: string): TaskBoardRpcId {
  return value as TaskBoardRpcId
}

describe('Task Board ApiProxy Session provider', () => {
  it('maps create, prompt, and cancel through ordinary Session APIs', async () => {
    const calls: Array<{ readonly method: string; readonly request: unknown }> = []
    const apiProxy = {
      sessions: {
        create: async (request: Parameters<ApiProxy['sessions']['create']>[0]) => {
          calls.push({ method: 'create', request })
          return {
            rpcId: request.rpcId,
            result: { ok: true as const, value: { sessionId: request.payload.sessionId! } },
          }
        },
        prompt: async (request: Parameters<ApiProxy['sessions']['prompt']>[0]) => {
          calls.push({ method: 'prompt', request })
          return { rpcId: request.rpcId, result: { ok: true as const, value: { accepted: true as const } } }
        },
        cancel: async (request: Parameters<ApiProxy['sessions']['cancel']>[0]) => {
          calls.push({ method: 'cancel', request })
          return { rpcId: request.rpcId, result: { ok: true as const, value: { accepted: true as const } } }
        },
      },
    } as unknown as ApiProxy
    const ctx = new Context()
    ctx.provide('apiProxy', apiProxy)
    await ctx.plugin(ApiProxyTaskBoardSessionProvider)
    const sessionId = SessionId('task-board-session')

    await expect(ctx.taskBoardSession.create({
      requestId: requestId('create-rpc'),
      sessionId,
      cwd: '/workspace',
    })).resolves.toEqual({ ok: true, value: { sessionId } })
    await expect(ctx.taskBoardSession.prompt({
      requestId: requestId('prompt-rpc'),
      sessionId,
      text: 'Implement the task.',
    })).resolves.toEqual({ ok: true, value: { accepted: true } })
    await expect(ctx.taskBoardSession.cancel({
      requestId: requestId('cancel-rpc'),
      sessionId,
    })).resolves.toEqual({ ok: true, value: { accepted: true } })

    expect(calls).toEqual([
      {
        method: 'create',
        request: {
          rpcId: RpcId('create-rpc'),
          payload: { sessionId, cwd: '/workspace' },
        },
      },
      {
        method: 'prompt',
        request: {
          rpcId: RpcId('prompt-rpc'),
          payload: {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: 'Implement the task.' }],
          },
        },
      },
      {
        method: 'cancel',
        request: {
          rpcId: RpcId('cancel-rpc'),
          payload: { sessionId },
        },
      },
    ])
  })

  it('normalizes ApiProxy rejections and transport failures', async () => {
    const apiProxy = {
      sessions: {
        create: async (request: Parameters<ApiProxy['sessions']['create']>[0]) => ({
          rpcId: request.rpcId,
          result: {
            ok: false as const,
            error: { code: 'session-conflict', message: 'already exists', details: {} },
          },
        }),
        prompt: async () => { throw new Error('offline') },
        cancel: async (request: Parameters<ApiProxy['sessions']['cancel']>[0]) => ({
          rpcId: request.rpcId,
          result: { ok: true as const, value: { accepted: true as const } },
        }),
      },
    } as unknown as ApiProxy
    const ctx = new Context()
    ctx.provide('apiProxy', apiProxy)
    await ctx.plugin(ApiProxyTaskBoardSessionProvider)
    const sessionId = SessionId('task-board-errors')

    await expect(ctx.taskBoardSession.create({
      requestId: requestId('create-error'),
      sessionId,
    })).resolves.toMatchObject({
      ok: false,
      failure: { stage: 'session-create', code: 'session-conflict', message: 'already exists' },
    })
    await expect(ctx.taskBoardSession.prompt({
      requestId: requestId('prompt-error'),
      sessionId,
      text: 'Retry',
    })).resolves.toEqual({
      ok: false,
      failure: {
        stage: 'prompt-admission',
        code: 'TRANSPORT_ERROR',
        message: 'Session prompt could not be admitted.',
      },
    })
  })
})
