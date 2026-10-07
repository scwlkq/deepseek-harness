# Agent Note: Apply XDG data-directory defaults for empty variables

Status: implemented

English | [中文](2026-10-07-xdg-data-directory-defaults.zh.md)

## Problem

Linux file-association discovery treated an empty `XDG_DATA_HOME` or `XDG_DATA_DIRS` value as an empty directory selection. The XDG Base Directory Specification assigns the standard fallback directories when either variable is unset or empty, so valid desktop entries could disappear from the “open with” list.

## Decision

`desktopDataDirectories` uses `$HOME/.local/share` when `XDG_DATA_HOME` is unset or empty, and `/usr/local/share:/usr/share` when `XDG_DATA_DIRS` is unset or empty. Explicit non-empty values retain their existing precedence and ordering. The Linux association provider continues to search the returned directories in order and keeps its existing handling for missing roots and entries.

## Alternatives considered

**Treat empty values as an intentional opt-out.** Rejected because it contradicts the XDG lookup rule and makes a common inherited environment value hide installed applications.

**Normalize all XDG paths in the provider.** Rejected because default selection belongs to the shared directory helper, which is also exported for callers that resolve icons and desktop entries.

## Consequences

Linux association discovery now sees user and system application roots when a launcher supplies empty XDG variables. Tests that need isolation must provide an explicit empty or nonexistent directory instead of relying on an empty variable. No desktop-entry parsing, launch authorization, or Windows/macOS behavior changes.

## Verification

The Linux file-association unit suite covers both populated fixtures and the empty-variable fallback. The affected package passes its independent TypeScript check, and the bilingual consistency record covers this note.
