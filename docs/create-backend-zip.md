# Create Backend Zip

Use this exact command from repo root after committing the backend changes:

```powershell
npm --prefix backend run package:eb
```

This creates `backend-deploy.zip` from `HEAD:backend`, which keeps Linux-safe forward-slash archive paths and excludes untracked files like `.env` and `node_modules`.

## Verify Archive Structure

```powershell
Expand-Archive -Path ./backend-deploy.zip -DestinationPath ./tmp_backend_check -Force
Get-ChildItem -Path ./tmp_backend_check | Select-Object Name
Remove-Item -Recurse -Force ./tmp_backend_check
```

Expected check: `package.json` and `index.js` should be visible at the archive root (inside `tmp_backend_check`), not nested under another `backend` folder.

## Beanstalk Env Vars

Add these in the Elastic Beanstalk environment before deploying the new ZIP:

```text
TG_HOST=<your TigerGraph cloud host URL>
TG_SECRET=<your TigerGraph auth secret>
TG_GRAPH=LearningGraph
DEMO_MODE=false
```
