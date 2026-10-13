# Changelog

## 0.1.0 — 2026-10-13

- Added configurable terminal, sound and desktop notifications.
- Added threshold alerts for conversation context and 5h/7d account windows.
- Added deduplication, window/compaction reset handling and event cooldowns.
- Added periodic and manual reading checks, timestamps and unavailable/stale states.
- Added project/global profiles and session controls.
- Added a panel backed by the engine agent list, with observed model, effort and result excerpts.
- Added a handoff request button that preserves the current draft.
- Corrected Zen progress at response end; kept failures visible and added detail expansion.
- Preserved child agent effort by default and isolated child progress from the main task.
- Added an explicit session-only option to override child effort.
- Kept theme customization, model selection, native permission controls and status line.
- Renamed plugin, command and marketplace to avoid collisions with extra-mods.
- Added official-runner integration tests; no fixed workflow phases.
