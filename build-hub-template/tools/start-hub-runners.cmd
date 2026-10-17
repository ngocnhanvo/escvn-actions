@echo off
setlocal
set "HUB_ROOT=%USERPROFILE%\ESC-Build\runners"
for %%W in (worker-01 worker-02) do (
  if not exist "%HUB_ROOT%\%%W\.runner" (
    echo ERROR: %%W not registered. Run setup-hub-runners.ps1 first.
    exit /b 1
  )
)
echo Starting TWO private hub runners. Closing either window stops that worker.
echo FTPS Gateway is unaffected.
start "ESC Build Worker 01" cmd /k "cd /d %HUB_ROOT%\worker-01 && run.cmd"
start "ESC Build Worker 02" cmd /k "cd /d %HUB_ROOT%\worker-02 && run.cmd"
endlocal
