param([switch]$InspectOnly)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$blob=[IO.File]::ReadAllBytes('C:/Users/jorda/AppData/Local/com.creatoragent.studio/secrets/session.dpapi')
$entropy=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:session')
try {
 $sessionValue=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 if($InspectOnly){$sessionValue|node (Join-Path $PSScriptRoot 'accept-approved-discovery-settings.mjs') --inspect}
 else{$sessionValue|node (Join-Path $PSScriptRoot 'accept-approved-discovery-settings.mjs')}
 if($LASTEXITCODE -ne 0){throw 'Settings update stopped; inspect before retrying.'}
}finally{$sessionValue=$null}
