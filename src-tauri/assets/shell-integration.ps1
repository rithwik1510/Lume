# Lume shell integration — emits OSC 133 (FinalTerm) command-lifecycle marks
# so Lume can tell EXACTLY when a command starts and finishes, instead of
# guessing from output cadence. Same convention VS Code / Warp / Windows
# Terminal use:
#   ESC]133;A BEL  — prompt start
#   ESC]133;B BEL  — prompt end (command input starts)
#   ESC]133;C BEL  — command execution starts
#   ESC]133;D;<exit code> BEL — command finished
#
# Dot-sourced by Lume via `-NoExit -Command . <this file>` AFTER the user's
# profile has loaded, so we wrap whatever prompt/PSReadLine setup the user
# (or oh-my-posh, starship, …) installed rather than replacing it.
# Compatible with Windows PowerShell 5.1 and pwsh 7+ ([char]27, no `e).

if ($global:__LumeIntegrationLoaded) { return }
$global:__LumeIntegrationLoaded = $true

$global:__LumeOrigPrompt = $function:prompt

function global:prompt {
    # D for the command that just finished (first prompt sends a harmless
    # D;0 — Lume ignores D when no command was running), then A + the real
    # prompt + B.
    $ec = $global:LASTEXITCODE
    if ($null -eq $ec) { $ec = 0 }
    $e = [char]27
    $b = [char]7
    $pre = "$e]133;D;$ec$b$e]133;A$b"
    $body = if ($global:__LumeOrigPrompt) { & $global:__LumeOrigPrompt } else { "PS $($executionContext.SessionState.Path.CurrentLocation)> " }
    "$pre$body$e]133;B$b"
}

# Mark "command executing" (C) the moment the line editor hands a submitted
# line to the host. PSReadLine defines PSConsoleHostReadLine — and it loads
# lazily right before the first prompt, AFTER this script runs, which would
# overwrite our wrapper. Import it eagerly first so our wrapper lands last.
# (If PSReadLine is unavailable the fallback ReadLine below still works; and
# Lume's tracker no longer depends on C — a D after a prompt also counts as
# "command finished".)
if (-not (Get-Module -Name PSReadLine)) {
    Import-Module PSReadLine -ErrorAction SilentlyContinue
}
$global:__LumeOrigReadLine = $function:PSConsoleHostReadLine

function global:PSConsoleHostReadLine {
    $line = if ($global:__LumeOrigReadLine) { & $global:__LumeOrigReadLine } else { [Console]::In.ReadLine() }
    $e = [char]27
    $b = [char]7
    [Console]::Write("$e]133;C$b")
    $line
}
