import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskBoardTask } from '../src/types.ts'
import { setupTaskBoard } from './helpers.ts'

type Runtime = Awaited<ReturnType<typeof setupTaskBoard>>

function createRequest(description: string, start = false) {
  return {
    title: '',
    description,
    acceptanceCriteria: `${description} is complete.`,
    cwd: '/tmp/project',
    start,
  }
}

function expectTask(result: Awaited<ReturnType<Runtime['service']['create']>>): TaskBoardTask {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`unexpected task-board failure: ${result.error.code}`)
  return result.value
}

describe('task-board MVP Host service', () => {
  let value: Runtime

  beforeEach(async () => {
    value = await setupTaskBoard()
  })

  afterEach(async () => {
    await value.dispose()
  })

  it('persists create, edit, reorder, and stale-revision rejection', async () => {
    const first = expectTask(await value.service.create(createRequest('Implement search')))
    const second = expectTask(await value.service.create(createRequest('Implement filters')))

    const edited = await value.service.edit({ id: first.id, revision: first.revision }, {
      title: 'Search',
      cwd: null,
    })
    expect(edited).toMatchObject({ ok: true, value: { title: 'Search', revision: 1 } })

    const stale = await value.service.edit({ id: first.id, revision: first.revision }, {
      title: 'Stale',
    })
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict', current: { title: 'Search', revision: 1 } },
    })

    const reordered = await value.service.reorder({ id: second.id, revision: second.revision }, {
      beforeTaskId: first.id,
    })
    expect(reordered.ok).toBe(true)

    const snapshot = await value.service.snapshot()
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        boardRevision: 4,
        tasks: [{ id: second.id }, { id: first.id, title: 'Search' }],
      },
    })
  })

  it('runs a task through Session completion, review, approval, and reopen', async () => {
    const running = expectTask(await value.service.create(createRequest('Implement board', true)))
    const sessionId = running.rounds.at(-1)?.sessionId
    expect(sessionId).toBeDefined()
    expect(running.status).toBe('running')
    expect(value.runtime.calls.map(call => call.method)).toEqual(['session.create', 'session.prompt'])

    value.runtime.appendPromptTurn(sessionId!, 0, { kind: 'completed' })
    value.runtime.setIdle(sessionId!)
    await value.service.whenSettled(running.id)

    const review = value.service.getTask(running.id)!
    expect(review).toMatchObject({ status: 'review', rounds: [{ status: 'completed' }] })

    const approved = await value.service.approve({ id: review.id, revision: review.revision })
    expect(approved).toMatchObject({ ok: true, value: { status: 'done' } })
    if (!approved.ok) throw new Error('approval failed')

    const reopened = await value.service.reopen({ id: approved.value.id, revision: approved.value.revision })
    expect(reopened).toMatchObject({
      ok: true,
      value: { status: 'initialized', rounds: [{ status: 'completed' }] },
    })
  })

  it('rejects review feedback in the same Session', async () => {
    const running = expectTask(await value.service.create(createRequest('Review loop', true)))
    const sessionId = running.rounds.at(-1)!.sessionId
    value.runtime.appendPromptTurn(sessionId, 0, { kind: 'completed' })
    value.runtime.setIdle(sessionId)
    await value.service.whenSettled(running.id)
    const review = value.service.getTask(running.id)!

    const rejected = await value.service.reject(
      { id: review.id, revision: review.revision },
      { feedback: 'Add empty-state coverage.' },
    )
    expect(rejected).toMatchObject({
      ok: true,
      value: {
        status: 'running',
        rounds: [{ sessionId }, { sessionId, trigger: 'revision' }],
      },
    })
    expect(value.runtime.calls.map(call => call.method)).toEqual([
      'session.create',
      'session.prompt',
      'session.prompt',
    ])
  })

  it('retries failure in a fresh Session without an allow-fresh request', async () => {
    const running = expectTask(await value.service.create(createRequest('Retry loop', true)))
    const firstSessionId = running.rounds.at(-1)!.sessionId
    value.runtime.appendPromptTurn(firstSessionId, 0, {
      kind: 'error',
      error: { code: 'MODEL_ERROR', message: 'provider failed' },
    })
    value.runtime.setIdle(firstSessionId)
    await value.service.whenSettled(running.id)
    const failed = value.service.getTask(running.id)!
    expect(failed.status).toBe('failed')

    const retried = await value.service.retry({ id: failed.id, revision: failed.revision })
    expect(retried.ok).toBe(true)
    if (!retried.ok) throw new Error('retry failed')
    expect(retried.value.status).toBe('running')
    expect(retried.value.rounds.at(-1)?.sessionId).not.toBe(firstSessionId)
    expect(value.runtime.calls.map(call => call.method)).toEqual([
      'session.create',
      'session.prompt',
      'session.create',
      'session.prompt',
    ])
  })

  it('stops an active task and keeps running deletion unavailable', async () => {
    const running = expectTask(await value.service.create(createRequest('Stop loop', true)))
    const denied = await value.service.delete({ id: running.id, revision: running.revision })
    expect(denied).toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', status: 'running', operation: 'delete' },
    })

    const stopped = await value.service.stop({ id: running.id, revision: running.revision })
    expect(stopped).toMatchObject({
      ok: true,
      value: { status: 'failed', rounds: [{ status: 'cancelled' }] },
    })
    expect(value.runtime.calls.at(-1)?.method).toBe('session.cancel')
  })

  it('returns stable admission errors and retains a failed round', async () => {
    const created = expectTask(await value.service.create(createRequest('Rejected prompt')))
    value.runtime.nextPromptError = {
      code: 'agent-busy',
      message: 'Agent is busy.',
      details: { reason: 'test Agent is busy' },
    }

    const result = await value.service.start({ id: created.id, revision: created.revision })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'prompt-rejected',
        failure: { stage: 'prompt-admission', code: 'agent-busy' },
      },
    })
    expect(value.service.getTask(created.id)).toMatchObject({
      status: 'failed',
      rounds: [{ status: 'failed' }],
    })
  })
})
