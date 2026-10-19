> Historical snapshot retained October 18, 2026. Status/setup statements below may be superseded; use the current README, local development guide and integration readiness summary.

# Creator Agent

T01 now provides a minimal local TypeScript API, CLI and React fixture demonstration. Start with [Local development](docs/LOCAL_DEVELOPMENT.md) for install/build/start/check commands and limitations. See [build status](tracking/BUILD_STATUS.md) for version-bound evidence and the next eligible milestone. No live AI, research or persistence is implemented.

The original implementation-kit introduction follows as historical context.

## Creator Agent implementation kit

Prepared for Jordan Price • October 9, 2026 • Version 3.0

This is a repository-ready specification and prompt package for building Creator Agent. It incorporates the existing product plans, September thesis materials, and the October 8 committee feedback. It contains instructions and templates, not an implemented application or evidence of completed experiments.

## Start here

1. Extract this folder. Copy its contents into a dedicated Creator Agent repository. If files with the same names already exist, have the coding agent compare and merge them; do not blindly overwrite existing instructions or user changes.
2. Start the coding tool in that repository. Read PROJECT_CONTEXT.md, then use prompt T00 in PROMPT_LIBRARY.md. Run one milestone at a time. The thesis track is the recommended first route; the full-product track preserves the wider vision.
3. After each milestone, inspect its completion report and updated tracking/BUILD_STATUS.md. A prompt being run does not mean its acceptance gate passed.
4. In a new conversation, use utility prompt U01 and the current tracking/SESSION_HANDOFF.md. The agent must check the repository before trusting a handoff.
5. Configure real models, accounts, and budget limits only when their implementation step needs them. All example configuration starts with live external effects disabled.

Paste this to begin:

```text
You are helping me implement Creator Agent. Read AGENTS.md, PROJECT_CONTEXT.md,
PROMPT_LIBRARY.md, context/DECISIONS_AND_OPEN_QUESTIONS.md, and
tracking/BUILD_STATUS.md. Follow the thesis track and execute T00 only.
Inspect the actual repository, preserve existing work, and record what is
implemented versus proposed. Do not begin T01 automatically. Complete useful
authorized work before raising any genuinely blocking question.
```

## What each file does

| File or folder     | Purpose                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| AGENTS.md          | Canonical instructions for a coding agent implementing the platform                                            |
| agent.md           | Requested singular filename; points to AGENTS.md without duplicating rules                                     |
| CLAUDE.md          | A short entry point telling Claude to read the same canonical instructions                                     |
| PROJECT_CONTEXT.md | Product vision, thesis requirements, constraints, scope, and priorities                                        |
| PROMPT_LIBRARY.md  | T00–T19 thesis milestones, X01–X10 full-product extensions, U01–U05 utility prompts                            |
| context/           | Architecture, requirements traceability, oversight, rubric, experiment protocol, roadmap, unresolved decisions |
| agents/            | Runtime role prompts for agents inside Creator Agent; these are separate from coding-agent instructions        |
| templates/         | Editable task, decision, dossier, run configuration, and experiment templates                                  |
| tracking/          | Initial implementation status, decision log, integration readiness, and session handoff                        |
| references/        | Archived earlier specifications and research guide, retained for detail and provenance                         |

The canonical coding instructions use the filename AGENTS.md, which Codex documents as a project instruction file. The singular agent.md is a compatibility pointer; do not assume every coding tool automatically reads it. For any tool, explicitly ask it to read AGENTS.md if discovery is uncertain. [Official guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md), checked October 9, 2026.

## Two delivery tracks

**Thesis track:** guided evidence-based discovery; honest scoring; configurable human oversight and humility; autonomous, human-assisted, and human-only evaluation; one complete tested prototype; searchable provenance, budgets, and a reproducible research package.

**Full-product track:** qualified model routing; deeper context optimization; comprehensive search; remote GitHub management; Windows desktop and paired workers; hosted operation; payments and reinvestment; marketing; reusable components; portfolio scheduling and maintenance.

These are delivery priorities proposed in this kit, not a claim that the committee approved a new scope. Advanced features remain requirements of the broader product. Their deferral must be visible.

## Important distinctions

- Approval controls in Creator Agent are runtime application behavior. These files do not change the permissions of the coding tool used to build it.
- A fully autonomous experiment runs inside a fixed, preauthorized boundary. It cannot approve its own expansion of that boundary. A necessary human intervention becomes a recorded stop or protocol deviation.
- No-code, existing-tool, process-change, human-led, hybrid, and decline/defer outcomes are legitimate. A prototype is required for the demonstration, but individual discovery trials are not forced to recommend software.
- Historical budgets, model prices, sample counts, and framework details in references are dated proposals. The new context and protocol take precedence; verify provider details at implementation time.

## Package validation

The package is checked for internal file links, prompt numbering/dependencies, JSON readability, coverage of requirement IDs, and archive integrity. Those checks validate this kit only. No application tests, model evaluations, live integrations, publication, or spending have been performed by creating it.
