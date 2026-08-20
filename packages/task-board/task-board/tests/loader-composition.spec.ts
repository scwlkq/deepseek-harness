import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SessionCheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as AgentSpine from '@deepseek-ai/dsh-agent-spine-demo'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as TaskBoardPlugin from '../../session-apiproxy/src/index.ts'

let root: string | undefined
const contexts: Context[] = []

const AttachmentProvider = {
  name: 'task-board-test-attachments',
  apply(ctx: Context) {
    return ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 10_000_000,
        maxImagesPerMessage: 10,
        maxMessageImageBytes: 20_000_000,
        maxImagePixels: 40_000_000,
        mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
      saveImage() { throw new Error('loader test does not save images') },
      readImage() { throw new Error('loader test does not read images') },
    } as never)
  },
}

const ApiSupportProvider = {
  name: 'task-board-test-api-support',
  apply(ctx: Context) {
    ctx.provide('userQuestions', {
      registerProvider: () => () => {},
    } as never)
    ctx.provide('directoryPicker', {
      capability: () => undefined,
    } as never)
    ctx.provide('subagents', {
      listChildren: async () => [],
      listDescendants: async () => [],
      followup: async () => { throw new Error('loader test has no subagents') },
      interrupt: () => {},
    } as never)
    ctx.provide('sessionQuery', {
      traceSession: async () => { throw new Error('loader test does not trace Sessions') },
    } as never)
    ctx.provide('workspaceRegistry', {
      archivedSessionIds: new Set(),
      list: () => [],
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async () => { throw new Error('loader test does not create Workspaces') },
    } as never)
  },
}

const ApiProxyProvider = {
  name: 'task-board-test-api-proxy',
  inject: [
    'agents',
    'attachments',
    'directoryPicker',
    'llm',
    'sessions',
    'sessionPersistence',
    'sessionQuery',
    'subagents',
    'userQuestions',
    'workspaceRegistry',
  ],
  apply(ctx: Context) {
    return ctx.provide('apiProxy', createApiProxy(ctx, {
      cwd: root!,
      defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
    }))
  },
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(adapter: LlmAdapter): Promise<Context> {
  if (root === undefined) throw new Error('loader root is not initialized')
  const configPath = join(root, 'cordis.yml')
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent-spine-demo', AgentSpine],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-session-checkpoint-policy', SessionCheckpointPolicy],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['task-board-test-attachments', AttachmentProvider],
    ['task-board-test-api-support', ApiSupportProvider],
    ['task-board-test-api-proxy', ApiProxyProvider],
    ['@deepseek-ai/dsh-task-board-session-apiproxy', TaskBoardPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  await vi.waitFor(() => {
    expect(ctx.get('llm')).toBeDefined()
    expect(ctx.get('taskBoard')).toBeDefined()
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

async function waitForTask(ctx: Context, id: Parameters<typeof ctx.taskBoard.getTask>[0]) {
  const task = ctx.taskBoard.getTask(id)
  const sessionId = task?.rounds.at(-1)?.sessionId
  if (sessionId !== undefined) await ctx.agents.get(sessionId)?.whenIdle()
  await ctx.taskBoard.whenSettled(id)
  return ctx.taskBoard.getTask(id)
}

describe('task board through real Loader composition', () => {
  it('persists the review loop and task rounds across a cold restart', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-board-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent-spine-demo'",
      '  config:',
      `    dshHome: ${JSON.stringify(join(root, 'home'))}`,
      '    persona: Task board loader test.',
      '    workspaceContext: false',
      '    skills:',
      '      enabled: false',
      '    toolBash: false',
      '    toolJobs: false',
      '    goals: false',
      "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'sessions'))}`,
      '    compression: none',
      '    writeBatchMaxDelayMs: 1',
      "- name: '@deepseek-ai/dsh-session-checkpoint-policy'",
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: 'task-board-test-attachments'",
      "- name: 'task-board-test-api-support'",
      "- name: 'task-board-test-api-proxy'",
      "- name: '@deepseek-ai/dsh-task-board-session-apiproxy'",
      '  config:',
      '    automaticTitleMaxChars: 80',
      '    maxTitleBytes: 512',
      '    maxDescriptionBytes: 32768',
      '    maxAcceptanceCriteriaBytes: 16384',
      '    maxFeedbackBytes: 16384',
      '',
    ].join('\n'))

    const first = await loadComposition(new MockAdapter([
      textResponse('First result'),
      textResponse('Revised result'),
    ]))
    const created = await first.taskBoard.create({
      title: '',
      description: 'Implement loader review flow',
      acceptanceCriteria: 'Human approval is required.',
      start: true,
    })
    if (!created.ok) throw new Error(`create failed: ${created.error.code}`)
    const firstReview = await waitForTask(first, created.value.id)
    expect(firstReview?.status).toBe('review')

    const rejected = await first.taskBoard.reject(
      { id: firstReview!.id, revision: firstReview!.revision },
      { feedback: 'Revise the result.' },
    )
    if (!rejected.ok) throw new Error(`reject failed: ${rejected.error.code}`)
    const secondReview = await waitForTask(first, rejected.value.id)
    expect(secondReview?.status).toBe('review')
    expect(secondReview?.rounds).toHaveLength(2)
    expect(secondReview?.rounds[0]?.sessionId).toBe(secondReview?.rounds[1]?.sessionId)

    const approved = await first.taskBoard.approve({
      id: secondReview!.id,
      revision: secondReview!.revision,
    })
    expect(approved.ok && approved.value.status).toBe('done')
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const restarted = await loadComposition(new MockAdapter([]))
    const snapshot = await restarted.taskBoard.snapshot()
    expect(snapshot.ok && snapshot.value.tasks).toHaveLength(1)
    expect(snapshot.ok && snapshot.value.tasks[0]).toMatchObject({
      status: 'done',
      identifier: 'DSH-1',
      rounds: [{ trigger: 'initial' }, { trigger: 'revision' }],
    })
  }, 30_000)

  it('does not retry a failed Agent turn until the user requests it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-board-loader-failure-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent-spine-demo'",
      '  config:',
      `    dshHome: ${JSON.stringify(join(root, 'home'))}`,
      '    persona: Task board failure test.',
      '    workspaceContext: false',
      '    skills:',
      '      enabled: false',
      '    toolBash: false',
      '    toolJobs: false',
      '    goals: false',
      "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'sessions'))}`,
      '    compression: none',
      '    writeBatchMaxDelayMs: 1',
      "- name: '@deepseek-ai/dsh-session-checkpoint-policy'",
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: 'task-board-test-attachments'",
      "- name: 'task-board-test-api-support'",
      "- name: 'task-board-test-api-proxy'",
      "- name: '@deepseek-ai/dsh-task-board-session-apiproxy'",
      '  config:',
      '    automaticTitleMaxChars: 80',
      '    maxTitleBytes: 512',
      '    maxDescriptionBytes: 32768',
      '    maxAcceptanceCriteriaBytes: 16384',
      '    maxFeedbackBytes: 16384',
      '',
    ].join('\n'))

    const adapter = new MockAdapter([
      () => { throw new Error('deterministic model failure') },
      textResponse('Retry result'),
    ])
    const ctx = await loadComposition(adapter)
    const created = await ctx.taskBoard.create({
      title: '',
      description: 'Fail once',
      acceptanceCriteria: '',
      start: true,
    })
    if (!created.ok) throw new Error(`create failed: ${created.error.code}`)
    const failed = await waitForTask(ctx, created.value.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.rounds).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.taskBoard.getTask(created.value.id)?.rounds).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)

    const retried = await ctx.taskBoard.retry({ id: failed!.id, revision: failed!.revision })
    if (!retried.ok) throw new Error(`retry failed: ${retried.error.code}`)
    const review = await waitForTask(ctx, retried.value.id)
    expect(review?.status).toBe('review')
    expect(review?.rounds).toHaveLength(2)
    expect(adapter.requests).toHaveLength(2)
  }, 30_000)
})
