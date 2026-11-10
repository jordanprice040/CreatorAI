# Runbook export (P16, ADR-0080)

A runbook is a ZIP of plain files that lets a separate coding model, or a person, carry out a
project that was specified in Creator Agent without access to the studio. Application code builds
it from one saved version of a spec or a proposal and the records that version follows. No model
writes it, nothing is stored when it is made, and making one grants or changes nothing.

## Where it is

- **Projects › Build**: every active spec with a valid task plan has "Export a runbook for another
  model". The panel says how many prompts and files the bundle has, whether the requirements are
  frozen, how many held-out cases were left out, and any warning; then "Download" or "Save to Files".
- **Projects › Proposals**: the same control under a saved proposal gives an _action runbook_ for a
  non-code plan.
- API: `GET workspaces/{ws}/specs/{id}/runbook` and `GET workspaces/{ws}/proposals/{id}/runbook`
  return the manifest, archive name and size; add `?format=zip` for the archive (`application/zip`,
  attachment, inert headers) and `?version=N` for an older version. `POST` on the same path with
  `{ "upload_key": "<uuid>", "version": N }` saves the archive into Files, linked to the spec or
  proposal. Any member may read or download; saving to Files needs write access.

## What a software runbook contains

| File                                  | Purpose                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                           | What it is for, warnings, how to use it, the prompts in order, validation commands, what is left out, provenance                |
| `CONTRACT.md`                         | The shared project contract, pasted before every prompt                                                                         |
| `REQUIREMENTS.md`                     | Audience, problem, flows, scope, non-goals, data, acceptance checks with their visible cases, risks, maintenance                |
| `TASKS.md`                            | The task plan in dependency order, with the files each task may change                                                          |
| `STACK.md`                            | The proposed stack and the limits that always apply                                                                             |
| `DECISIONS.md`                        | Decided and recorded, proposed by the bundle, assumptions, still to decide                                                      |
| `EVIDENCE.md`                         | The problem's linked claims with their sources and short quotes                                                                 |
| `RECOVERY.md`                         | What to do when a gate fails                                                                                                    |
| `prompts/NN-*.md`                     | Setup, one prompt per task, independent review and repair, verify and hand over                                                 |
| `spec.json`, `checks/acceptance.json` | The requirements and visible cases as data                                                                                      |
| `checks/run_checks.py`                | Runs the command-line cases (Python 3 standard library); present when a check has such cases                                    |
| `manifest.json`                       | `runbook/1`: subject version and hash, freeze, selection, prompts, what was withheld, a SHA-256 of every file and a bundle hash |

Each prompt file names its prerequisites, scope, expected artifacts and completion gate, then holds
the prompt in one text block for copying.

An action runbook (from a proposal) has `README.md`, `CONTRACT.md`, `PLAN.md` (the proposal's
canonical Markdown export), `DECISIONS.md`, `EVIDENCE.md`, `RECOVERY.md`, the manifest and prompts
for: understanding the plan, closing unknown sections with the owner (only when some are unknown),
preparing, carrying out and recording, and evaluating. Its contract says people do the work, the
assistant never reports a step as done on its own word, and unknown sections stay unknown.

## Rules the export follows

- **Versions and hashes.** The bundle names the spec or proposal id, version, content hash and saved
  time, the freeze of exactly that version (or says it is not frozen), the selection and whether a
  later one replaced it, and the option and problem versions. It carries no export time, so the same
  version and records give the same bytes, and saving it to Files twice keeps one copy.
- **Decisions and proposals are kept apart.** The selection, the freeze and a humility review of the
  spec are listed as decided and recorded. The stack, the order of independent tasks and the prompt
  wording are listed as proposed by the bundle. Open points (freezing, stack, who judges manual
  checks, held-out cases, private data, release and licence) are listed for the owner.
- **Held-out cases never leave.** Their arguments, input and expected output are dropped; only the
  count is reported. The prompts say that passing the visible cases does not show acceptance.
- **Redaction.** Before anything is written, every text field is scanned for well-known credential
  formats (provider keys, tokens, private key blocks, bearer values, passwords inside addresses, also with an empty user name as in `redis://:password@host`; a raw `,` or `?` in a password is allowed, so text joined to such an address by one of them may be removed with it; a password holding a raw `@` together with a `|`, `<`, `>`, or a quote or backtick followed by punctuation or a space, may be only partly removed, because it cannot be told apart from a table, tag or quoted list) and
  for personal folder paths (`C:\Users\name\…`, `\\host\Users\name\…`, `/home/name/…`,
  `/Users/name/…`, `/mnt/c/Users/name/…`). Matches are
  replaced and counted in the manifest and the README. The scan is a pattern list, not a guarantee:
  read a bundle before sending it outside. Windows profile paths match in any letter case; a lower-case
  macOS `/users/name` counts only before a profile folder in its real spelling (`Documents`), so web routes such as `/users/me` are
  kept. An account name of up to four words joined by ordinary spaces is caught only when what
  follows it is clearly more path: a profile folder such as `Documents`, another folder and
  separator, a file name with an extension, a last folder that ends the text or line, is closed by
  a straight or curly quote, backtick, bracket, brace, `*`, `~`, `|` or `»`, or by `_` before a space or the end, or is followed by a sentence mark (`.`, `,`, `;`, `:`, `!`, `?`) and a space, or a bare separator. A closing mark inside a path (`DOCUME~1`, `scans(old)`) does not end it; only one at its end stays outside, as does a sentence mark (`.`, `,`, `;`, `:`, `!`, `?`) after the path, also when the path ends at the account name. Otherwise only the
  first word is caught ("…\Jordan Price\Projects - see", or "C:\Users\Jordan Price" with nothing
  after it). The rule can also remove up to three words of prose after a path when a slash follows
  them ("/home/ci and Linux/macOS."), which errs on the safe side. Forms such as
  `C:\Documents and Settings\name`, URL-encoded paths, and names with non-breaking spaces, curly
  apostrophes or more than four words are not on the list. A spec with approved private data exports its visible cases as written and
  says so in a warning.
- **Only cited records.** The bundle holds the spec or proposal, the selection's decision for that
  option, the option's rationale, trade-offs and uncertainty, a humility review of the spec, and the
  problem's active linked claims with their non-retracted sources (at most 60 claims, 10 sources
  each). Scores, chat, notes, files, other options, reviews of a proposal, run and budget records
  and retracted evidence are not included.
- **Text cannot forge structure.** Record text is flattened and escaped; multi-line text sits in a
  fenced block longer than any backtick run inside it.
- **Self-check.** `validateRunbook` runs on every export and refuses a bundle whose manifest, hashes,
  prompt order, internal links or exclusions do not hold, and the app shows the reason. No checker
  ships in the bundle; its README says how to check the file hashes and the bundle hash with any
  tool (each file's SHA-256, and a SHA-256 over one "path, space, hash, line feed" line per file).
  The other checks need Creator Agent's code.
- **A recipe name is not a qualification.** `recipe` says which studio recipe the spec's checks fit
  (`python-build/1`, `static-web/1`, `mixed`, `none`). It does not say any model can build it.
- **An invalid task plan is refused**, with the reason, instead of exported.
- **The studio's own build gate is reported.** A spec with no should-this-be-software (humility)
  review, a review the pre-build gate would not accept (it recommends something other than
  building, judged another version, or found the approach not viable) or an unresolved serious
  ethical problem still exports, with a warning in the manifest, the README and the app, the
  review's ethics note and dissent in `DECISIONS.md`, and an open decision for the owner.
- **The frozen version stays reachable.** When the current spec version is a draft and an older
  one is frozen, the panel offers the frozen version as well.

## The synthetic example

`tracking/evidence/runbook-export/synthetic-bundle/` is the unpacked bundle of a made-up project
(a word-count command with two build tasks, a review task and two held-out cases). It is generated
from `RUNBOOK_FIXTURE_INPUT`; `node scripts/p16-runbook-example.mjs` verifies the committed files
match the code and `… write` regenerates them. A test runs the verification.

## Limits

- **Independent consumption was run once.** On November 10 a separate session built the synthetic
  project in an empty folder from only the bundle, and both held-out cases passed
  ([record](../tracking/evidence/runbook-export/clean-room-2026-11-10.md)). One session did all six
  prompts and it was the same kind of model that built the exporter. Its seven findings about
  missing or unclear context were fixed in the generator afterwards. A second run on the fixed
  bundle passed again and found them resolved, but it was not blind; its three small wording
  findings are fixed too and that last wording has not been consumed again.
- The runner covers command-line cases only. Browser cases are written out as steps; no browser
  checker is shipped.
- A selection without a spec or a proposal has nothing to export; write one first.
- No CLI command; the app and API are the paths.
- Markdown and a ZIP only. No PDF or Word output.
