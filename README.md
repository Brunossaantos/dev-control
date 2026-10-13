# Dev Control

**English** · [Português](README.pt-BR.md)

A universal Claude Code mod for usage monitoring, configurable notifications, honest Zen progress, themes, project/global profiles and agent observation. It does not impose a development workflow.

## Install

Requires **Claude Code 2.1.296+** and support for early-access mods/function hooks. The engine/account must enable that capability.

Extract the ZIP, open a terminal in the extracted `dev-control` directory, then run:

```sh
claude --version
claude plugin marketplace add .
claude plugin install dev-control@dev-control-mods --scope user
```

Start a new session or run `/reload-plugins`. Open **◆ dev-control ▲** or `/dev-control`.

To try it without installing:

```sh
claude --plugin-dir ./plugins/dev-control
```

If extra-mods is enabled, disable it to avoid competing render hooks:

```sh
claude plugin disable extra-mods@jdsjh-mods --scope user
```

## Features

| Panel | Features |
|---|---|
| Usage monitor | Context and account windows, reset countdowns, timestamps, manual refresh and handoff draft. |
| Notifications | Independent terminal, sound and desktop channels; configurable events, thresholds and cooldowns. |
| Zen | Step-based progress, waiting/interrupted/failed states, expandable details and visible errors. |
| Theme / Mode | Original theme picker, native model switching and permission controls; child effort preserved by default. |
| Profiles | Save model, effort, Zen, theme and notifications per project or globally. |
| Agents | Engine-backed listing, filtering and observed model, effort and result excerpts. No agents are spawned. |
| Status line | Model, directory, branch, context, account windows and estimated cache age. |

## Notifications and profiles

Open `/dev-control notifications`. Terminal warnings are on; sound and desktop notifications are off until selected. The included audio clip needs no external download. Thresholds default to **70%, 85%, 95%** and are editable. A jump across bands produces one highest-band warning per metric. Thresholds rearm on a new window or significant context reduction. Missing readings are unavailable, not zero.

Response-finished notices are off by default. Tool/response errors and input-needed notices are on. Other event cooldowns default to 60 seconds and are separate per event category. Use **Send test notification** to check selected channels. Save a project or global profile to restore the controls in new sessions; the project profile takes precedence.

Desktop notifications use a temporary tray balloon via PowerShell on Windows, `osascript` on macOS, or `notify-send` in a graphical Linux session. WSL attempts Windows PowerShell. OS permissions, focus settings and installed tools may prevent display. The panel reports channel failures without disabling other channels. It does not install notification dependencies automatically.

## Data and progress

Plain engine usage checks do not generate model requests. Checks default to a minimum 30-second interval, on a 15-second scheduler, and stop when the session ends. Account windows are reread from the last API response the engine holds; this is not a separate live balance API. No exact remaining-message or token-savings claim is made.

Cache age is a one-hour time estimate, not proof of a cache hit. Zen percentage counts completed steps; an ended response cannot force an incomplete plan to 100%. Results still need verification. Child agents do not replace the main plan.

**Prepare handoff request** appends a concise continuity request to the existing draft. Only pressing Enter submits it. It does not automatically run a model or compact the session.

Agent results are excerpts of up to 1,000 characters observed in the current session. The panel shows the latest 12 filtered entries and links to native `/tasks`. Model and effort are shown only when observed.

Profiles use the plugin's private storage; they do not write project files or bypass native permission checks. Theme selection retains upstream behavior: it writes Claude settings and may temporarily recolor other Windows Terminal tabs using the same profile, with backups. Child effort override is an explicit session-only option, off by default.

## Commands and maintenance

```text
/dev-control [usage|notifications|zen|themes|mode|profiles|agents|handoff]
```

Keep the extracted directory in place. After replacing it with a newer package:

```sh
claude plugin marketplace update dev-control-mods
claude plugin update dev-control@dev-control-mods
```

Uninstall:

```sh
claude plugin uninstall dev-control@dev-control-mods --scope user
```

## Development

The plugin itself needs no npm or Python installation. The inherited standalone Python status line under `statusline/` does not implement the new mod features.

```sh
claude plugin validate ./plugins/dev-control --strict
claude plugin test ./plugins/dev-control
claude plugin validate . --strict
```

Run `/plugin-types` in Claude Code to generate the declarations matching your version before using TypeScript's type checker. Adjust tsconfig includes if the engine writes them elsewhere. The API is early access and can change.

Validated with Claude Code **2.1.296**: **43 tests passed**, including engine-runner UI and integration tests. Notification delivery and physical terminal painting still need verification on the target machines; the test runner stubs OS operations. See [VERIFICACAO.md](VERIFICACAO.md).

Derived from [ClaudeMods](https://github.com/Jhonatan-de-Souza/ClaudeMods), by Jhonatan de Souza. See [NOTICE.md](NOTICE.md) for source provenance and the upstream licensing status, and [CHANGELOG.md](CHANGELOG.md) for changes.
