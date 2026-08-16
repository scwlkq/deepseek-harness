# task-board/：持久化 Agent 任务

[English](README.md) | 中文

Task Board 家族在普通 Harness Session 之上提供持久工作项。任务卡负责工作流、排序、审核决策和精简的执行轮次摘要；Session 日志仍是提示词、模型输出和工具活动的权威来源。

| 包 | 职责 | Cordis 服务 |
|---|---|---|
| [`task-board/`](task-board/README.md) | 五态工作流、Storage Domain 持久化、Session 接入定义和生成的 `taskBoard` Remote API | `taskBoard`、`taskBoardSession` |
| [`session-apiproxy/`](session-apiproxy/README.md) | 通过 Host ApiProxy 提供 Session 接入并挂载 Task Board 的单入口 Web 组合包 | `taskBoard`、`taskBoardSession` |
| [`../client/ui-task-board/`](../client/ui-task-board/README.md) | 侧边栏入口、五列看板、任务详情、审核操作和 Session 链接 | — |

工作流为 `initialized → running → review → done`；执行或取消失败进入 `failed`。通过、驳回、重试、停止、重新打开和删除均是显式 Host 变更。拖拽只调整当前状态列内的顺序。

Web profile 只暴露一个 `task-board` Loader 条目。Host 和 Client 代码保留为不同源码包，是因为二者处于不同编译和运行平面，而不是要求用户分别安装。
