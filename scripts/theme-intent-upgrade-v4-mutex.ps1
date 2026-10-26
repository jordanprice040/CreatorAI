param([Parameter(Mandatory=$true)][string]$Name,[Parameter(Mandatory=$true)][int]$OwnerPid)
$ErrorActionPreference='Stop'
$owner=Get-Process -Id $OwnerPid -ErrorAction Stop
$birth=$owner.StartTime.ToUniversalTime().Ticks
$mutex=New-Object Threading.Mutex($false,$Name)
$held=$false
try {
 try {$held=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$held=$true}
 if(-not $held){exit 3}
 [Console]::Out.WriteLine('ACQUIRED')
 [Console]::Out.Flush()
 $reader=New-Object IO.StreamReader([Console]::OpenStandardInput())
 $line=$reader.ReadLineAsync()
 while(-not $line.IsCompleted){
  Start-Sleep -Milliseconds 100
  $current=Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
  if(-not $current -or $current.StartTime.ToUniversalTime().Ticks -ne $birth){break}
 }
} finally {
 if($held){$mutex.ReleaseMutex()}
 $mutex.Dispose()
}
