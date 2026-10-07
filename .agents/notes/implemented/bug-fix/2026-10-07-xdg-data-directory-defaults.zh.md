# Agent Note：为空的 XDG 变量应用数据目录默认值

Status: implemented

[English](2026-10-07-xdg-data-directory-defaults.md) | 中文

## 问题

Linux 文件关联发现把空的 `XDG_DATA_HOME` 或 `XDG_DATA_DIRS` 当成空目录选择。XDG 基础目录规范规定变量未设置或为空时使用标准回退目录，因此有效的桌面条目可能不会出现在“打开方式”列表中。

## 决策

`desktopDataDirectories` 在 `XDG_DATA_HOME` 未设置或为空时使用 `$HOME/.local/share`，在 `XDG_DATA_DIRS` 未设置或为空时使用 `/usr/local/share:/usr/share`。显式提供的非空值保持原有优先级和顺序。Linux 文件关联提供方继续按顺序搜索这些目录，并保留对缺失目录和条目的现有处理。

## 考虑过的替代方案

**把空值视为有意退出。** 否决，因为这违反 XDG 查找规则，并会让启动器常见的继承环境值隐藏已安装应用。

**在提供方中统一处理所有 XDG 路径。** 否决，因为默认目录选择属于共享目录辅助函数；该函数也导出给解析图标和桌面条目的调用方。

## 后果

当启动器传入空的 XDG 变量时，Linux 文件关联发现现在会看到用户目录和系统应用目录。需要隔离的测试必须提供显式的空目录或不存在目录，不能再依赖空变量。桌面条目解析、启动授权以及 Windows/macOS 行为不变。

## 验证

Linux 文件关联单元测试覆盖已有 fixture 和空变量回退。受影响的包通过了独立 TypeScript 检查，本记录也有中英文一致性记录。
