# Agent Note：原生 Task Board 插件

Status: implemented

[English](2026-08-14-task-board-plugin.md) | 中文

## 问题

Harness Session 可以保留模型可见执行历史，但不能表示一个跨越多轮执行、等待人工审核、与其他工作稳定排序并在重启后继续存在的持续工作项。若从彼此无关的对话重建该工作流，就会丢失任务权威状态、审核决策和稳定排序。

## 决策

Task Board 是一个跨 Host 和 Client 编译平面实现的产品插件。`@deepseek-ai/dsh-task-board` 负责持久任务卡、五态工作流、轮次摘要、比较并交换变更、Storage Domain 持久化、Session 对账、与 provider 无关的 `TaskBoardSessionService`，以及生成的 `taskBoard` Remote 命名空间。`@deepseek-ai/dsh-client-ui-task-board` 通过 Client slot 提供侧边栏入口和全屏看板。

Web profile 把 `@deepseek-ai/dsh-task-board-session-apiproxy` 作为唯一的 `task-board` 条目加载。该组合包通过 Host ApiProxy 提供 `TaskBoardSessionService`，并挂载 Host 工作流。Provider 不能成为 `@deepseek-ai/dsh-task-board` 的直接依赖：Host ApiProxy 会访问包含 Task Board 的生成 remotes，因此直接依赖会形成 `task-board → host-apiproxy → api/remotes → task-board`。把适配器留在组合包中，既保持 Host 核心与 provider 无关，也让设置页只显示一个插件。

任务卡使用 `initialized`、`running`、`review`、`done` 和 `failed`。成功执行始终进入 `review`；只有显式通过才能进入 `done`。驳回必须填写反馈，并延续同一 Session。重试必须由用户显式触发，并创建新 Session。拖拽只调整同一状态列内的顺序。

Storage Domain `task_board` 是任务卡、工作流状态、排序和轮次摘要的权威来源。Session 日志仍是提示、模型输出、工具和终止结果的权威来源。Task Board 只保存 Session 引用和关联证据，不复制对话。

## 考虑过的替代方案

### 独立 Session 定义包

只包含 `TaskBoardSessionService` 的包会增加发布和文档单元，却没有独立演进的能力。定义应由消费它的工作流持有，只有传输 provider 保持分离。

### 直接依赖 Host ApiProxy

Task Board 直接依赖 Host ApiProxy 会形成上述生成 Remote 依赖环，并把工作流核心绑定到 Web 传输。单入口组合包同时解决这两个问题。

### 完整项目管理界面

附件暂存、逐任务 Preset 与 Workspace 选择器、第二套列表视图、内嵌对话渲染和自定义执行日志都会重复现有 Harness 界面，并扩大插件维护范围。看板只保留任务工作流，每个轮次通过 Session 链接提供完整执行详情。

### 从 Session 派生任务卡或跨状态拖拽

Session 事件无法提供持久审核状态、验收标准和稳定看板排序。跨状态拖拽会绕过 Session 创建、取消、必填反馈、审核记录和重试接入。工作流转换只能由显式 Host 操作完成。

## 验证

Host 状态与服务测试覆盖持久化、比较并交换冲突、Session 接入、审核、重试、取消和 Loader 组合。Client 测试覆盖同步、pending 抑制、创建、详情操作和同列排序。组装后的无密钥 Web 快照会启动已构建插件产物，并验证五列、搜索、创建、通过、驳回、重试和 Session 链接。

## 后果

- 用户只配置和看到一个 `task-board` 插件，Host 核心、Host 组合和 Client UI 仍是不同源码包。
- 看板聚焦持久 Agent 任务工作流；完整执行历史继续通过关联 Session 提供。
- 驳回保留对话连续性，重试则明确不继承失败 Session 的对话上下文。
- 新 Session 传输只需实现 `TaskBoardSessionService` 并提供自己的组合包，无需修改任务持久化或 Client 代码。
