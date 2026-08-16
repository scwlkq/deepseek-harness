# @deepseek-ai/dsh-task-board-session-apiproxy

English | [中文](README.zh.md)

This Host package is the Web profile's single Task Board Loader entry. It provides `TaskBoardSessionService` through ordinary Host ApiProxy Session methods, then mounts `TaskBoardService` with the same user configuration.

## Composition

The package requires `ctx.apiProxy`. Session creation uses the deployment default Agent Preset, prompt admission uses the ordinary Session prompt path, and stop delegates to Session cancellation. Transport failures are converted into stable, user-safe Task Board failures.

Its `Config` composes `@deepseek-ai/dsh-task-board` without adding fields. Loading this package therefore produces both `ctx.taskBoardSession` and `ctx.taskBoard` while Settings displays one `task-board` entry.

## Model Experience

### Session admission adapter

#### What the model sees

The `TaskBoardSessionService` adapter adds no model-visible fields. It forwards prompts already authorized by Task Board into ordinary Harness Sessions.

#### Token effect

The adapter adds no direct token cost. Model usage comes from the Session turn admitted for a start, rejection, or retry.

#### KV Cache effect

The adapter does not choose cache policy. Rejections continue the linked Session, while initial starts and retries use the fresh Sessions requested by Task Board.

## Known Limitations and Deferred Work

- This provider is specific to Host ApiProxy deployments; another transport needs a different `TaskBoardSessionService` provider.
- The package does not select an Agent Preset per task; Session creation uses the deployment default.
