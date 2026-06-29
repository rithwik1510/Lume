@echo off
setlocal
rem Lume agent-event hook shim (Plan 008 §2). Installed into
rem ~/.claude/settings.json hook arrays; claude runs it on every session
rem lifecycle event. Deliberately dumb: NO parsing here — the Rust watcher
rem does that. Guard: if not launched under Lume (LUME_PANE_ID unset), do
rem nothing so `claude` outside Lume is never touched.
if "%LUME_PANE_ID%"=="" exit /b 0
set "LUME_SPOOL_DIR=%~dp0agent-events"
if not exist "%LUME_SPOOL_DIR%" mkdir "%LUME_SPOOL_DIR%"
rem findstr "^" passes every stdin line through byte-exact; append the raw
rem hook JSON (one line) to this pane's spool file. The filename carries the
rem pane id; the body is untouched hook JSON.
findstr "^" >> "%LUME_SPOOL_DIR%\%LUME_PANE_ID%.jsonl"
exit /b 0
