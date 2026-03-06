# Create Backend Zip (PowerShell)

Use this exact command from repo root:

```powershell
cd backend
Compress-Archive -Path * -DestinationPath ../backend-fixed.zip -Force
```

## Verify Archive Structure

```powershell
Expand-Archive -Path ../backend-fixed.zip -DestinationPath ../tmp_backend_check -Force
Get-ChildItem -Path ../tmp_backend_check | Select-Object Name
Remove-Item -Recurse -Force ../tmp_backend_check
```

Expected check: `package.json` and `index.js` should be visible at the archive root (inside `tmp_backend_check`), not nested under another `backend` folder.
