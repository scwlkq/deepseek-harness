# @deepseek-ai/dsh-task-board-session-apiproxy

[English](README.md) | 中文

该 Host 包是 Web profile 中唯一的 Task Board Loader 条目。它通过普通 Host ApiProxy Session 方法提供 `TaskBoardSessionService`，然后使用同一份用户配置挂载 `TaskBoardService`。

## 组合方式

该包依赖 `ctx.apiProxy`。创建 Session 时使用部署默认 Agent Preset，提示接入使用普通 Session prompt 路径，停止操作委托给 Session 取消。传输失败会转换为稳定且可安全展示的 Task Board 失败信息。

它的 `Config` 组合 `@deepseek-ai/dsh-task-board`，不增加字段。因此加载该包会同时提供 `ctx.taskBoardSession` 和 `ctx.taskBoard`，而设置页只显示一个 `task-board` 条目。

## 模型体验

### Session 接入适配器

#### 模型看到什么

该 `TaskBoardSessionService` 适配器不增加模型可见字段，只把 Task Board 已授权的提示传入普通 Harness Session。

#### Token 影响

该适配器不直接增加 token 成本。模型用量来自启动、驳回或重试时接入的 Session 轮次。

#### KV Cache 影响

该适配器不选择缓存策略。驳回会延续关联 Session，首次启动和重试则使用 Task Board 请求的新 Session。

## 已知限制与后续工作

- 该 provider 仅适用于 Host ApiProxy 部署；其他传输需要不同的 `TaskBoardSessionService` provider。
- 该包不按任务选择 Agent Preset；Session 创建使用部署默认值。
