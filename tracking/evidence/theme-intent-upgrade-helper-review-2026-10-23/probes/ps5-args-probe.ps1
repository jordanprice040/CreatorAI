param([string]$ApprovalFile)
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot 'argv.mjs'
"--- unbound ApprovalFile"
node $runner before 'ev dir' $ApprovalFile --presecret
"--- empty-string ApprovalFile"
$e=''; node $runner before 'ev dir' $e --presecret
"--- approval with embedded quote"
$q='a"b c.json'; node $runner admit 'ev' $q --presecret
"--- non-ASCII password via pipe (OutputEncoding=" + $OutputEncoding.EncodingName + ")"
@{password='pä§s'}|ConvertTo-Json -Compress|node $runner x --stdin
"--- native failure under Stop; LASTEXITCODE check reached?"
node $runner --fail
"LASTEXITCODE=$LASTEXITCODE (script continued)"
