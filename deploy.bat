@echo off
cd /d "%~dp0"
echo ==========================================
echo   Quiz Battle - Deploy
echo ==========================================
echo.
echo [1/3] Committing changes...
git add -A
git commit -m "config: wire Firebase and fix serverNow"
echo.
echo [2/3] Creating GitHub repo and pushing...
gh repo create quiz-battle --public --source=. --remote=origin --push
echo.
echo [3/3] Enabling GitHub Pages...
gh api -X POST repos/nanjungj/quiz-battle/pages -f "source[branch]=master" -f "source[path]=/"
echo.
echo ==========================================
echo   DONE! Wait 1-2 minutes, then open:
echo   Admin  : https://nanjungj.github.io/quiz-battle/admin.html
echo   Player : https://nanjungj.github.io/quiz-battle/index.html
echo ==========================================
echo.
pause
