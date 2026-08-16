/** Invariant companion for the Task Board ApiProxy composition. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-board-session-apiproxy'

/** Cordis companion plugin name. */
export const name = 'task-board-session-apiproxy-invariant'

/** Invariant registry must exist before companion registration. */
export const inject = ['invariants']

/** No runtime invariant: provider methods are direct typed translations of one ApiProxy call. */
export const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
