# @deepseek-ai/dsh-client-ui-task-board

English | [中文](README.zh.md)

This Client plugin contributes one sidebar launcher and one full-frame Task Board overlay through existing slots. It has no independent settings entry.

## Interaction model

The overlay renders five fixed columns: Initialized, Running, Review, Done, and Failed. Users can search retained fields, create a task, edit non-running tasks, reorder cards within one column, and open task details. Detail actions start, stop, approve, reject with required feedback, retry, reopen, or delete according to the current state.

Each execution round appears as a compact status summary with a link to its Harness Session. The linked Session is the place to inspect full messages, model output, and tool activity.

## Synchronization

`TaskBoardController` installs an authoritative snapshot, applies contiguous `task-board/changed` events, and refreshes once when it observes a revision gap. Compare-and-set conflicts replace the stale local card with the Host value. Per-task pending state prevents duplicate mutations while allowing unrelated cards to remain interactive.

## Model Experience

### Task execution controls

#### What the model sees

The Client plugin adds no model context, prompt text, or tools. It calls the generated `taskBoard` Remote namespace; when a user starts, rejects, or retries a task, the Host service sends the retained task content through ordinary Session user messages.

#### Token effect

Opening, searching, editing, reordering, approving, and navigating the board use no model tokens. Start, reject, and retry actions consume tokens only after the Host admits an ordinary Session prompt.

#### KV Cache effect

The Client does not choose cache policy. Rejection targets the linked Session; starts and retries follow the Host's fresh-Session behavior.

## Known Limitations and Deferred Work

- Creation uses the deployment default Agent Preset and an optional working-directory text field; it does not expose Preset or Workspace pickers.
- The plugin does not upload attachments or copy Session transcripts into the board.
- Cards cannot be dragged across states; workflow changes require explicit detail actions.
