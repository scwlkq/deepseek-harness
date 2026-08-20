// @vitest-environment jsdom

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import {
  installAssembledBootEnv,
  mountAssembledApp,
  REFRESHING_GOLDEN,
} from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/task-board/five-state-board.expected.txt')

function boardShape(board: HTMLElement): string {
  return [...board.querySelectorAll<HTMLElement>('section[data-status]')]
    .map((column) => {
      const cards = [...column.querySelectorAll<HTMLElement>('article[data-status]')]
        .map(card => `  card=${card.textContent?.replace(/\s+/g, ' ').trim() ?? '<missing>'}`)
      const heading = column.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() ?? '<missing>'
      return [`column=${column.dataset.status} heading=${heading}`, ...cards].join('\n')
    })
    .join('\n')
}

async function openBoard(): Promise<HTMLElement> {
  mountAssembledApp()
  fireEvent.click(await screen.findByRole('button', { name: 'Task Board' }, { timeout: 10_000 }))
  const board = await screen.findByRole('region', { name: 'Task Board' })
  const alert = within(board).queryByRole('alert')
  if (alert !== null) throw new Error(alert.textContent ?? 'task board failed without a message')
  return board
}

function openTask(board: HTMLElement, name: RegExp): void {
  fireEvent.click(within(board).getByRole('button', { name }))
}

installAssembledBootEnv()

it('mounts the five-state board and filters cards', async () => {
  const board = await openBoard()

  for (const status of ['Initialized', 'Running', 'Review', 'Done', 'Failed']) {
    within(board).getByRole('heading', { name: status })
  }

  const shape = boardShape(board)
  if (REFRESHING_GOLDEN) {
    mkdirSync(dirname(EXPECTED), { recursive: true })
    writeFileSync(EXPECTED, shape)
  }
  await expect(shape).toMatchFileSnapshot(EXPECTED)

  fireEvent.change(within(board).getByRole('searchbox', { name: 'Search tasks' }), {
    target: { value: 'provider timeout' },
  })
  within(board).getByRole('button', { name: /DSH-5 Repair provider timeout/ })
  expect(within(board).queryByRole('button', { name: /DSH-1 Plan authentication boundary/ })).toBeNull()
})

it('creates and immediately starts one agent task', async () => {
  const board = await openBoard()
  fireEvent.click(within(board).getByRole('button', { name: 'New task' }))

  const dialog = await screen.findByRole('dialog', { name: 'New agent task' })
  fireEvent.change(within(dialog).getByLabelText('Title'), {
    target: { value: 'Ship compact task board' },
  })
  fireEvent.change(within(dialog).getByLabelText('Task description'), {
    target: { value: 'Keep the core agent task workflow focused.' },
  })
  fireEvent.change(within(dialog).getByLabelText('Acceptance criteria'), {
    target: { value: 'The new card starts and exposes its Session.' },
  })
  fireEvent.change(within(dialog).getByLabelText('Working directory (optional)'), {
    target: { value: '/tmp/fixture' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create and start agent' }))

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'New agent task' })).toBeNull()
  })
  openTask(board, /DSH-6 Ship compact task board/)
  const detail = await screen.findByRole('dialog', { name: 'Ship compact task board' })
  within(detail).getByText('Running', { selector: '[data-status="running"]' })
  within(detail).getByRole('button', { name: 'Open Session fx-alpha' })
})

it('approves or rejects a reviewed task and retains its Session link', async () => {
  const board = await openBoard()
  openTask(board, /DSH-3 Review release workflow/)

  const detail = await screen.findByRole('dialog', { name: 'Review release workflow' })
  const sessionLink = within(detail).getByRole('button', { name: 'Open Session fx-beta' })
  fireEvent.click(sessionLink)
  fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }))
  await waitFor(() => {
    within(detail).getByRole('button', { name: 'Reopen' })
  })
})

it('requires review feedback before continuing the same task', async () => {
  const board = await openBoard()
  openTask(board, /DSH-3 Review release workflow/)

  const detail = await screen.findByRole('dialog', { name: 'Review release workflow' })
  fireEvent.click(within(detail).getByRole('button', { name: 'Reject and continue' }))
  within(detail).getByText('Enter rejection feedback.')

  fireEvent.change(within(detail).getByLabelText('Rejection feedback'), {
    target: { value: 'Add rollback verification before approval.' },
  })
  fireEvent.click(within(detail).getByRole('button', { name: 'Reject and continue' }))
  await waitFor(() => {
    within(detail).getByRole('button', { name: 'Stop run' })
    within(detail).getByText('Round 2')
  })
})

it('retries a failed task without extra recovery choices', async () => {
  const board = await openBoard()
  openTask(board, /DSH-5 Repair provider timeout/)

  const detail = await screen.findByRole('dialog', { name: 'Repair provider timeout' })
  within(detail).getByText('The deterministic fixture provider timed out.')
  fireEvent.click(within(detail).getByRole('button', { name: 'Retry' }))
  await waitFor(() => {
    within(detail).getByRole('button', { name: 'Stop run' })
    within(detail).getByText('Round 2')
  })
})
