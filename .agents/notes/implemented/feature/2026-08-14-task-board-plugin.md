# Agent Note: Native Task Board plugin

Status: implemented

English | [中文](2026-08-14-task-board-plugin.zh.md)

## Problem

Harness Sessions preserve model-visible execution history but do not represent a continuing work item that spans execution rounds, waits for human review, stays ordered beside other work, and survives restart. Reconstructing that workflow from unrelated conversations loses task authority, review decisions, and stable ordering.

## Decision

Task Board is one product plugin implemented across Host and Client compiler planes. `@deepseek-ai/dsh-task-board` owns durable cards, the five-state workflow, round summaries, compare-and-set mutations, Storage Domain persistence, Session reconciliation, the provider-neutral `TaskBoardSessionService`, and the generated `taskBoard` Remote namespace. `@deepseek-ai/dsh-client-ui-task-board` contributes the sidebar launcher and full-frame board through Client slots.

The Web profile loads `@deepseek-ai/dsh-task-board-session-apiproxy` as its single `task-board` entry. That composition package provides `TaskBoardSessionService` through Host ApiProxy and mounts the Host workflow. The provider cannot live as a direct dependency of `@deepseek-ai/dsh-task-board`: Host ApiProxy reaches generated remotes that include Task Board, so the direct dependency would create `task-board → host-apiproxy → api/remotes → task-board`. Keeping the adapter in the composition package preserves a provider-neutral Host core while Settings still shows one plugin.

Cards use `initialized`, `running`, `review`, `done`, and `failed`. Successful execution always enters `review`; only explicit approval enters `done`. Rejection requires feedback and continues the same Session. Retry is explicit and creates a fresh Session. Dragging changes order only within one state column.

Storage Domain `task_board` is authoritative for cards, workflow state, ordering, and round summaries. Session logs remain authoritative for prompts, model output, tools, and terminal outcomes. Task Board stores Session references and correlation evidence instead of copying transcripts.

## Alternatives considered

### Separate Session-definition package

A package containing only `TaskBoardSessionService` adds another release and documentation unit without an independently evolving capability. The definition belongs with the workflow that consumes it; only the transport provider remains separate.

### Direct Host ApiProxy dependency

Depending on Host ApiProxy from Task Board creates the generated-remote cycle described above and binds the workflow core to the Web transport. The one-entry composition package resolves both problems.

### Full project-management surface

Attachment staging, per-task Preset and Workspace pickers, a second list view, embedded transcript rendering, and custom execution logs duplicate existing Harness surfaces and enlarge the plugin's maintenance boundary. The board retains task workflow and links each round to its Session for complete execution detail.

### Derive cards from Sessions or move cards across states

Session events cannot supply durable review state, acceptance criteria, or stable board ordering. Cross-state dragging would bypass Session creation, cancellation, required feedback, approval recording, and retry admission. Explicit Host actions remain the only workflow transitions.

## Verification

Host state and service tests cover persistence, compare-and-set conflicts, Session admission, review, retry, cancellation, and Loader composition. Client tests cover synchronization, pending suppression, creation, detail actions, and same-column ordering. The assembled keyless Web snapshot boots built plugin artifacts and exercises all five columns, search, creation, approval, rejection, retry, and Session links.

## Consequences

- Users configure and see one `task-board` plugin even though Host core, Host composition, and Client UI remain separate source packages.
- The board stays focused on durable agent-task workflow; complete execution history remains available through linked Sessions.
- Rejection preserves conversational continuity, while retry intentionally starts without the failed Session's conversation context.
- A new Session transport implements `TaskBoardSessionService` and supplies its own composition without changing task persistence or Client code.
