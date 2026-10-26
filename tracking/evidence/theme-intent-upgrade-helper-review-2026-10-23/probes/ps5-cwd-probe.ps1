$ErrorActionPreference='Stop'
Set-Location -LiteralPath 'C:\dev\creator_agent'
"PS location      : $((Get-Location).Path)"
".NET CurrentDir  : $([Environment]::CurrentDirectory)"
"GetFullPath(rel) : $([IO.Path]::GetFullPath('.verification/theme-intent-artifacts-2026-10-23/Creator Agent_0.1.0_x64-setup.exe'))"
"Test-Path that   : $(Test-Path -LiteralPath ([IO.Path]::GetFullPath('.verification/theme-intent-artifacts-2026-10-23/Creator Agent_0.1.0_x64-setup.exe')))"
"node cwd         : $(node -e 'console.log(process.cwd())')"
