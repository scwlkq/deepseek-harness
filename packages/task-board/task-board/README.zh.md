# @deepseek-ai/dsh-task-board

[English](README.md) | 中文

该 Host 包负责持久任务卡、五态工作流、执行轮次摘要、Storage Domain 持久化、与传输实现无关的 `taskBoardSession` 服务，以及生成的 `taskBoard` Remote 命名空间。

## 配置

```yaml
- name: '@deepseek-ai/dsh-task-board'
  config:
    automaticTitleMaxChars: 80
    maxTitleBytes: 4096
    maxDescriptionBytes: 65536
    maxAcceptanceCriteriaBytes: 65536
    maxFeedbackBytes: 32768
```

所有值都必须是正安全整数。自动标题按 Unicode 码点限制；请求文本按 UTF-8 字节限制，并在持久化或 Session 接入前失败。

## 工作流

任务卡使用 `initialized`、`running`、`review`、`done` 和 `failed`。启动初始化任务时，系统使用部署默认 Agent Preset 创建新 Session。执行轮次完成后进入 `review`；通过后进入 `done`；驳回必须填写非空反馈，并在同一 Session 中启动修订轮次。重试始终创建新 Session。停止操作取消活动轮次，并在任务离开 `running` 前记录失败或已取消的终止轮次。

每个任务保留只追加的轮次列表。轮次记录 Session id、提示关联信息、时间、终止状态、可选反馈和可安全展示的失败摘要。完整对话与工具历史保留在关联 Session 中。

## 持久化与同步

Storage Domain form `task_board` 保存一条看板元数据和每个任务的一条记录。每次提交变更都会增加看板版本；每个任务还带有比较并交换版本。过期变更返回携带当前任务的 `revision-conflict`，不会覆盖新状态。

Remote 命名空间提供 `snapshot`、`create`、`edit`、`reorder`、`start`、`stop`、`approve`、`reject`、`retry`、`reopen` 和 `delete`。只有持久化成功后才会发送 `task-board/changed`。客户端遇到事件版本缺口时通过权威快照修复。

## Session 接入

`TaskBoardSessionService` 定义创建、提示和取消操作，不依赖具体传输。Web profile 使用 [`@deepseek-ai/dsh-task-board-session-apiproxy`](../session-apiproxy/README.md)，在一个 Loader 条目中挂载 provider 和本服务。

## 模型体验

### 任务执行消息

#### 模型看到什么

Task Board 不增加系统提示词或模型工具。`TaskBoardSessionService` 通过普通 Session 用户消息接入初始需求、验收标准、驳回反馈和重试说明，因此 Session 日志可以重建所有模型可见输入。

#### Token 影响

读取看板、搜索、排序、编辑、审核通过和 Session 导航不会消耗模型 token。启动、驳回或重试会创建一个普通用户轮次，并产生对应模型用量。

#### KV Cache 影响

驳回会延续当前 Session，并可按所选模型 provider 的策略复用缓存。首次启动和重试会创建新 Session，不继承此前任务轮次的对话缓存。

## 已知限制与后续工作

- Task Board 不包含调度器或自动重试循环；用户需要显式启动或重试任务。
- 一个任务同一时间只能有一个活动轮次，执行中的任务不能编辑或删除。
- 轮次记录是摘要而非对话副本；完整执行详情应在关联 Session 中查看。
