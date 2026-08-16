# @deepseek-ai/dsh-client-ui-task-board

[English](README.md) | 中文

该 Client 插件通过现有 slot 提供一个侧边栏入口和一个全屏 Task Board 浮层，不创建独立设置条目。

## 交互模型

浮层固定展示五列：初始化、执行中、待审核、已完成和失败。用户可以搜索保留字段、创建任务、编辑非执行中任务、在同一列内排序，并打开任务详情。详情操作会根据当前状态提供启动、停止、通过、填写必需反馈后驳回、重试、重新打开或删除。

每个执行轮次显示为精简状态摘要，并提供 Harness Session 链接。完整消息、模型输出和工具活动应在关联 Session 中查看。

## 同步

`TaskBoardController` 安装权威快照、应用连续的 `task-board/changed` 事件，并在发现版本缺口时刷新一次。比较并交换冲突会用 Host 当前值替换过期本地任务。逐任务 pending 状态会阻止重复变更，同时让无关任务继续可交互。

## 模型体验

### 任务执行控制

#### 模型看到什么

该 Client 插件不增加模型上下文、提示词或工具。它调用生成的 `taskBoard` Remote 命名空间；用户启动、驳回或重试任务时，Host 服务会通过普通 Session 用户消息发送保留的任务内容。

#### Token 影响

打开、搜索、编辑、排序、审核通过和导航看板不会使用模型 token。只有 Host 接受普通 Session 提示后，启动、驳回和重试才产生 token 用量。

#### KV Cache 影响

Client 不选择缓存策略。驳回面向关联 Session；启动和重试遵循 Host 的新 Session 行为。

## 已知限制与后续工作

- 创建任务使用部署默认 Agent Preset 和可选工作目录文本字段，不提供 Preset 或 Workspace 选择器。
- 该插件不上传附件，也不把 Session 对话复制到看板。
- 任务卡不能跨状态拖拽；工作流变化必须通过详情中的显式操作完成。
