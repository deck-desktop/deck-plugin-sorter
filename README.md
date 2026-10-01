# Sorter

Files new downloads into folders by type.

Watches the downloads folder and moves things into folders by extension, on rules you set. A file
is left alone until it has stopped changing, so a part-downloaded file is never moved out from
under the browser writing it.

Sorting is previewed before it runs: the plan is a list you can look at, not something that
happens and is then explained.

## What it exports

| Export | Where it renders |
|---|---|
| `default` | the tab: rules, and the plan for the next sweep |
| `mcp` | running a sweep and reading the rules, for an agent |

## Build

```sh
node plugins/sorter/build.mjs
```

See [../README.md](../README.md) for how the build and the shims work.

## Install

Copy `plugin.json` and `plugin.js`, `mcp.js` into `%APPDATA%\Deck\plugins\sorter\` (`Deck-Dev` for a
debug build) and restart Deck.
