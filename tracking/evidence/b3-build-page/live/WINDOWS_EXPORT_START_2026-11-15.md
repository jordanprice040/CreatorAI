# Windows export start (B3 step 2, Jordan's PC, 2026-11-15 00:09 UTC)

Package: attempt 1 of `p14-repair-v1` (artifact `3e959695…`, archive sha256 `6715647921b5…80c1c7`, 4,608 bytes),
downloaded with the CLI's `artifact-download` (the same API Try uses) and saved under the name the Build page
gives, `creator-113cb77fbf-3e959695.tar`, in a fresh empty folder. Windows PowerShell 5.1.26100.9818,
Windows 11 Pro 26200, `py` launcher → Python 3.13.0.

Steps exactly as the Build page shows them (Windows (PowerShell)):

| Step                                                                       | Result                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `mkdir my-product; tar -xf creator-113cb77fbf-3e959695.tar -C my-product`  | works; `tar` exit 0; `src\main.py` and `readme.md` extracted |
| `cd my-product; py -3 -I src\main.py` (visible cases piped on stdin)       | works in a default console (code page 437), see below        |

Visible cases, input piped as a PowerShell string (`"Cy,80`nCy,82`nCy,83`nCy,84" | py -3 -I src\main.py`):

| Case          | Expected                         | Printed (console code page 437) |
| ------------- | -------------------------------- | ------------------------------- |
| A1.2          | `Cy 82.3 (4)`, exit 0            | `Cy 82.3 (4)`, exit 0           |
| A1.1          | `bob 90.0 (1)` / `Ann 82.5 (2)`  | same, exit 0                    |
| A2.1          | `line 5: invalid`, exit 2        | same, exit 2                    |
| A3.1 `--min 2`| `Ann 85.0 (2)`, exit 0           | same, exit 0                    |

Caveat found: when the console's input code page is UTF-8 (65001, e.g. after `chcp 65001` or with the
"Use Unicode UTF-8 for worldwide language support" setting), Windows PowerShell 5.1 sends a byte-order
mark before piped text. The first record's name then starts with U+FEFF: A1.2 printed `Cy 83.0 (3)` and
`\ufeffCy 80.0 (1)`, and A2.1 printed `line 1: invalid`. Setting `$OutputEncoding` alone does not fix it;
`[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false`, `cmd /c "py -3 -I src\main.py < file.csv"`
or PowerShell 7 (`pwsh`) all give `Cy 82.3 (4)`. The program follows its spec; this is a shell input issue.

`python3 --version` in PowerShell: `C:\Users\jorda\AppData\Local\Microsoft\WindowsApps\python3.exe` is the
Microsoft Store alias stub. It prints "Python was not found; run without arguments to install from the
Microsoft Store…" and exits 9009, so the manifest's `python3 -I src/main.py` does not start here; `py -3`
does.
