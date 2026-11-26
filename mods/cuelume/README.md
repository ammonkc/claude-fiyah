# Cuelume for Claude Code

Two [Cuelume](https://github.com/danielwh2/cuelume) sounds for Claude Code, so you can look away while it works.

| When | Cue |
| --- | --- |
| A turn of ten seconds or more ends with an answer | `ready` |
| A permission prompt is waiting on you | `attention` |

Short replies, interrupted turns and subagent turns stay silent.

## Install

```
claude plugin install cuelume@claude-fiyah
```

It needs a Claude Code version with mods, and macOS: Claude Code plays plugin audio through `afplay`, so other platforms stay silent.

## Themes

```
/cuelume            show the current theme
/cuelume bubble     switch to default, mech, bubble or press, and hear it
/cuelume off        no sounds
```

Your choice is kept across sessions.

`press` is modelled on the trackpad and keycap sounds in DawoodUI's Artasaka preview.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `readyEnabled` | on | Play `ready` when a long turn ends. Turn it off if notify or plan-progress already tells you. |
| `attentionEnabled` | on | Play `attention` when a permission prompt waits. |
| `minSeconds` | 10 | A turn must run at least this long before `ready` rings. |
| `gain` | 1.4 | Playback gain for the bundled sounds, from 0.1 to 3. |

A value that is missing, not a number or out of range falls back to its default.

## What it does on your machine

It plays the WAV files bundled in this folder and keeps your theme choice in Claude Code's plugin store. It reads nothing else, runs no other program and sends nothing over the network.

## Hooks

The plugin registers four hooks. None of them makes a decision for you. The first three pass their event on unchanged and return what Claude Code gave back; the last answers the plugin's own command.

| Hook | When it runs | What it does | What it decides |
| --- | --- | --- | --- |
| `classic.PermissionRequest` | A permission prompt is about to show | Plays `attention` | Nothing. It never allows, denies or answers the request; that decision stays with you |
| `turn.complete` | A turn ends | Plays `ready` if the turn ran long enough | Nothing. The answer is returned as it was |
| `session.start` | A session starts | Registers the `/cuelume` command | Nothing |
| `command.run` | You run `/cuelume` | Saves the theme you chose and plays it | Nothing |

## How the sounds are made

Cuelume synthesizes its cues live with Web Audio. A Claude Code mod can only play audio files, so each cue here is rendered once from Cuelume's own recipes to a 48 kHz WAV. The renderer uses the library's own room and noise and leaves out the small variation between plays, so a cue here sounds the same every time. The WAVs sit at the library's level, peaking near -18 dBFS, and the plugin plays them at 1.4 times that by default.

## Source and changes

Copied from [danielwh2/cuelume](https://github.com/danielwh2/cuelume), folder `claude-code/`, plugin 0.1.5, last changed upstream in commit `4a1c9f8574b3a3c9901521fb63d09128a5de1717`. Licensed MIT (see LICENSE). The sound files and icon are unchanged.

Changes in this copy (version 0.2.0):

* The four settings above. Upstream hardcodes both cues on, ten seconds and a gain of 1.4.
* A hook waits at most five seconds for a sound after its own work is done. Upstream waits without a limit, so a stuck audio call could hold up a permission answer or the end of a turn.
* Tests for each of these.

To take an upstream change, diff against that commit, read the diff, and copy again.
