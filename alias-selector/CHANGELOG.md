# Changelog

## 2026-03-15
### Changed - Purpose: compatible with Warp.dev shell
- Added `--print` mode: interactive UI renders on `/dev/tty` and the selected command is printed to stdout, allowing `eval "$(aaa --print)"` to run aliases — including `cd` — natively in the current shell without spawning a subshell
- Updated shell integration alias to use `eval "$(... --print)"` pattern, fixing `cd` aliases in Warp and other terminals

## 2025-02-18
### Fixed
- Fixed issue that can not run "cd"