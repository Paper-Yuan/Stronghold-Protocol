@rem ==========================================================================
@rem Stronghold-Protocol Gradle Execution Wrapper
@rem ==========================================================================
@echo off
setlocal

set GRADLE_BIN=
if exist "%USERPROFILE%\.gradle\wrapper\dists\gradle-8.0.2-all\25ipb77ce0ypy3f9xdton1ae6\gradle-8.0.2\bin\gradle.bat" (
    set "GRADLE_BIN=%USERPROFILE%\.gradle\wrapper\dists\gradle-8.0.2-all\25ipb77ce0ypy3f9xdton1ae6\gradle-8.0.2\bin\gradle.bat"
) else (
    for /f "delims=" %%i in ('where gradle 2^>nul') do (
        set "GRADLE_BIN=%%i"
    )
)

if "%GRADLE_BIN%"=="" (
    echo [ERROR] Gradle not found in system or .gradle/wrapper/dists.
    exit /b 1
)

call "%GRADLE_BIN%" %*
exit /b %ERRORLEVEL%
