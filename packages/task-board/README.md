# task-board/ — durable agent tasks

English | [中文](README.zh.md)

The Task Board family adds persistent work items around ordinary Harness Sessions. Cards own workflow, ordering, review decisions, and compact execution-round summaries; Session logs remain authoritative for prompts, model output, and tool activity.

| Package | Role | Cordis service |
|---|---|---|
| [`task-board/`](task-board/README.md) | Five-state workflow, Storage Domain persistence, Session admission definition, and generated `taskBoard` Remote API | `taskBoard`, `taskBoardSession` |
| [`session-apiproxy/`](session-apiproxy/README.md) | One-entry Web composition that provides Session admission through Host ApiProxy and mounts Task Board | `taskBoard`, `taskBoardSession` |
| [`../client/ui-task-board/`](../client/ui-task-board/README.md) | Sidebar launcher, five-column board, task details, review actions, and Session links | — |

The workflow is `initialized → running → review → done`; execution or cancellation failures enter `failed`. Approval, rejection, retry, stop, reopen, and deletion are explicit Host mutations. Dragging changes order only within the current state column.

The Web profile exposes one `task-board` Loader entry. Host and Client code remain separate source packages because they compile and execute on different planes, not because users install separate features.
