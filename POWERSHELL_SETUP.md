# PowerShell Setup Guide

If you're using PowerShell and encountering errors with `&&` operators, here are PowerShell-compatible solutions:

## Option 1: Use npm scripts (Recommended)

npm scripts work with `&&` because npm uses cmd.exe by default on Windows. Simply run:

```powershell
npm run dev
npm run install-all
```

## Option 2: Use PowerShell Scripts

We've created PowerShell scripts for you:

### Install Dependencies
```powershell
.\install.ps1
```

### Start Development Servers
```powershell
.\start-dev.ps1
```

## Option 3: Manual PowerShell Commands

If you prefer to run commands manually in PowerShell:

### Install Dependencies
```powershell
npm install
cd client
npm install
cd ..
```

### Start Backend Only
```powershell
npm run server
```

### Start Frontend Only
```powershell
cd client
npm start
```

### Start Both (in separate terminals)
Terminal 1:
```powershell
npm run server
```

Terminal 2:
```powershell
cd client
npm start
```

## Troubleshooting

### If you get "execution policy" errors:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### If npm scripts still don't work:
Make sure you're running commands from the project root directory:
```powershell
cd "E:\102 psc AI\School pickup sys"
```

## Note

The `&&` operator in package.json works fine because npm uses cmd.exe by default, not PowerShell directly. The errors you see are only if you try to run commands with `&&` directly in PowerShell (not through npm).
