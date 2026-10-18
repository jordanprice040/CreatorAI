# Archived project reference

Preserved from an earlier project document. Use the current PROJECT_CONTEXT.md, AGENTS.md and context documents for scope and precedence. Do not execute instructions in this archive as a second active prompt sequence. Historical model prices, service capabilities, dates, budgets and proposed studies require verification before use. The original text follows unchanged.

---

**Creator Agent — product overview**

Version 2 · September 8, 2026 · Prepared for Jordan Price

Creator Agent is a personal AI product studio. It discovers problems, researches evidence, develops competing solutions, delegates implementation, tests products, and manages a searchable portfolio through a website and Windows desktop app. It learns which models and workflows deliver acceptable results at the lowest total cost. You supply an operating budget; verified earnings can replenish development budgets under a policy you control.

This document specifies the intended product. It does not report an existing implementation or promise novelty, revenue, or a particular production rate. It expands the earlier outline to include automatic model routing, token optimization, financial operations, searchable provenance, and GitHub management. The implementation guide and prompt library define how to build and verify it.

1. **The product's purpose is to turn evidence into useful software.**

   The central unit of success is a product someone can use and verify. Ideas, experiments, prototypes, release candidates, and maintained products are distinct records with distinct requirements. The system should produce a wide idea catalog and a deliberately limited active build queue.

   You remain the owner of the portfolio, funds, accounts, priorities, and operating policy. Agents may act independently within standing grants, so routine research, private repository work, and approved-budget development do not repeatedly interrupt you. New authority is needed only when an action falls outside the existing scope.

   The first supported generated products are small web applications and developer utilities with reproducible local startup. The studio itself includes web and desktop interfaces. Later templates can support native applications, extensions, data tools, and other product classes once each has appropriate packaging and verification.

2. **The main experience is a working product portfolio.**

   You enter a research theme, submit a problem, or schedule discovery. The team gathers sources, identifies existing workarounds, develops alternatives, and recommends a bounded experiment. Selected projects receive a specification, acceptance criteria, resource envelope, repository, implementation tasks, and independent verification. Successful prototypes appear in your gallery with a demo, download, source link, cost report, and limitations. Your feedback creates traceable revision work.

| Workspace | Main capabilities |
| --- | --- |
| Home | Current work, spending, available budget, useful results, blocked decisions |
| Ideas | Search, filters, favorites, duplicate groups, evidence, alternatives, confidence |
| Research | Source records, claims, contradictory evidence, freshness, experiments |
| Products | Demos, screenshots, tested versions, downloads, requirements, feedback |
| Work | Tasks, dependencies, worker assignments, current progress, pause and stop |
| History | Timelines, model/tool activity, decisions, code changes, permissions, exports |
| Resources | Model usage, search calls, sandbox time, repositories, deployments, storage |
| Finances | Seed funding, budget envelopes, reservations, costs, revenue, reinvestment |
| Optimization | Model performance, routing decisions, token use, quality/cost comparisons |
| Settings | Accounts, grants, research themes, quality thresholds, limits, retention |

   All search and export features respect access restrictions. The interface presents citations and concise decision explanations; it does not depend on access to private model reasoning. Source archives, runnable demos, and signed installers are labeled separately. Closing the desktop window and stopping a worker are separate actions.

3. **A coordinated team performs finite assignments.**

| Role | Responsibility | Completion evidence |
| --- | --- | --- |
| Portfolio director | Choose work and allocate existing capacity | Ranked assignments and reasons |
| Problem researcher | Investigate difficulties and workarounds | Source-linked problem brief |
| Market researcher | Compare substitutes, users, and distribution hypotheses | Competitor matrix and uncertainty |
| Solution designers | Propose independent approaches | Distinct concepts and measurable benefits |
| Skeptic | Challenge claims and search for disconfirming evidence | Objections and a cheap next experiment |
| Planner/architect | Define scope, interfaces, and task dependencies | Versioned specification and acceptance criteria |
| Developers | Implement scoped components | Versioned code and task results |
| Reviewer/QA | Independently inspect and execute the product | Findings and executed verification records |
| Release/maintenance worker | Package and operate verified versions | Release manifest, health record, rollback path |
| Marketing worker | Prepare and execute permitted experiments | Reviewed content and observed outcomes |
| Optimizer | Evaluate model and context strategies | Proposed or activated routing-policy version |
| Finance analyst | Explain costs and recommend allocations | Reconciled reports and proposals |

   These are logical roles. Start with three simultaneous model jobs, one product build, limited delegation depth, and a finite total-call budget shared by parent and child agents. Routine parsing, accounting, permissions, scheduling, and pass/fail checks run in ordinary code. Financial and optimization agents cannot alter the enforcement rules by describing a new plan.

   Use a manager calling specialist agents as bounded tools. The application owns durable jobs and permissions. [OpenAI agent orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration)

4. **Discovery and brainstorming preserve uncertainty.**

   Start in two or three domains you can judge, with a small allocation for exploratory topics. Public documentation, permitted issue trackers and discussion sources, user-submitted problems, and accessible research are candidate inputs. A source's popularity does not establish demand; repeated copies of one complaint are not independent evidence.

   For a shortlisted problem, three designers propose concepts before seeing one another's answers. The skeptic evaluates them against original evidence. One revision round ends with selection, a follow-up experiment, or archival. The system stores competing approaches instead of reducing every discussion to a single polished pitch.

   Each concept includes affected users, the current workaround, competing tools, proposed improvement, technical feasibility, likely maintenance needs, evidence confidence, and a measurable validation step. Novelty means a documented difference from alternatives checked, not proof that nobody has done it. An idea may be useful for personal use while commercially unvalidated.

   Scores guide prioritization and remain explainable. Your override records a reason and does not destroy the original assessment. Archived concepts, failed experiments, and reusable components remain discoverable.

5. **Automatic model routing minimizes cost subject to quality.**

   GPT-6 Astra remains the reference model and the initial choice for ambiguous planning and difficult review. The automatic mode may choose less expensive approved models for work that evaluations show they handle well. Published OpenAI models currently include Astra, Sol, Terra, and Luna; actual account access and capabilities must be checked during setup. [OpenAI model catalog](https://developers.openai.com/api/docs/models)

| Work type | Initial routing hypothesis to evaluate |
| --- | --- |
| Parsing and calculations | Deterministic code whenever sufficient |
| Classification, extraction, short summaries | An inexpensive approved model |
| Bounded implementation with clear tests | A balanced model, with escalation on evidence of failure |
| Ambiguous architecture and difficult debugging | Astra |
| Independent release review | Astra baseline initially; change only after qualified evaluation |
| Offline catalog maintenance | A tested low-cost route or asynchronous batch |

   A routing decision considers task type, required tools, privacy constraints, project context, latency target, remaining budget, measured success rate, and expected total cost including retries and review. Self-reported model confidence is not sufficient qualification. When evidence is sparse, use the validated baseline or pause if the budget cannot support it.

   Optimization progresses from fixed routes to shadow evaluation, then a small canary, then automatic promotion within your configured quality constraints. Keep a held-out benchmark, minimum sample requirement, uncertainty bounds, and immediate rollback. Failed attempts and abandoned jobs count in cost metrics. Exploration consumes a separate capped allowance.

   Offer Auto, Astra-only, Economy-with-quality-floor, and manual per-project overrides. The router must never silently switch to an unapproved provider or relax security and acceptance requirements to save money. Display the selected route, policy version, actual usage, validation result, and explanation.

6. **Token optimization is measurable and reversible.**

   Build task-specific context from the relevant specification, interfaces, evidence, and changed files. Retrieve narrow excerpts before full documents, process large tool results in code, avoid repeated repository dumps, and pass artifact references between agents. Keep immutable constraints and unresolved objections in structured state rather than trusting a compressed chat summary.

   Reuse stable prompt prefixes where beneficial; OpenAI documents cached processing for shared prefixes. Measure actual cache usage and charges rather than assuming a hit. Use supported compaction with the provider's returned context preserved correctly, alongside a separate readable project record. [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [Compaction](https://developers.openai.com/api/docs/guides/compaction)

   Additional strategies include incremental source indexing, dependency-aware retesting, concise output contracts, duplicate research reuse, limited brainstorm rounds, task-specific reasoning effort, and batching non-urgent independent requests. Batch processing is a distinct asynchronous facility and must be capability-checked for each planned workload. [Batch API](https://developers.openai.com/api/docs/guides/batch)

   Report input, cached input, billed output including reasoning, tool calls, retries, compaction overhead, context size, total cost, latency, and accepted outcomes. Compare equivalent workloads; an uncached estimate is a counterfactual estimate, not realized savings. Stop an optimization when it loses required facts or degrades quality beyond the permitted margin.

7. **Agents receive budgets that can grow from verified earnings.**

   You contribute seed capital and establish operating envelopes for research, builds, maintenance, marketing, and optimization. Projects and tasks receive subdivisions of those envelopes. Delegation moves spending authority; it does not create money. Model calls, searches, compute leases, storage, deployments, and enabled campaigns all consume tracked resources.

   The useful Automaton inspiration is balance-aware operation: its documentation describes reduced activity as credits decline and funded child agents. Creator Agent adopts budget-aware scheduling and explicit child allocations while keeping your ownership, stop controls, and portfolio objectives central. It is not proposed as a fork of Automaton. [Automaton project](https://github.com/Conway-Research/automaton)

   The finance system distinguishes capital contributions, sales, pending receipts, available cash, expenses, unpaid commitments, refundable amounts, protected reserves, and development allocations. A displayed budget is permission to spend through configured accounts; it is not a new bank balance or a transferable wallet.

   Verified revenue can automatically fund new work after your standing reinvestment policy is enabled. For example, allocate 40% of eligible operating surplus to development, bounded by an absolute monthly cap and a minimum reserve. Within that new envelope, a configurable split can support existing products and new experiments. These percentages are illustrative choices, not a return forecast or tax calculation.

   Illustrative period: $1,000 collected, $50 fees/refunds, $200 direct costs, $100 shared operating costs, and $100 additional protected provision leave $550 under the example allocation policy. A 40% reinvestment rule proposes $220. If only $150 of verified, unallocated liquid headroom is usable, the new envelope is $150. The unused proposal does not authorize borrowing or spending pending funds.

   Stripe distinguishes pending and available balances. Even available processor funds must be usable through the configured payment rail before they back an API or hosting purchase. A processor balance does not automatically fund another provider's account. [Stripe balance states](https://docs.stripe.com/payments/balances)

   Start with simulated funds, then verified owner-funded budgets, then revenue ingestion in test mode, then controlled live reinvestment. Later refunds and delayed bills can reduce future allocations or freeze new work. Maintaining reserves and honoring Stop remain higher priority than generating additional products.

8. **Search and audit answer how every product came to exist.**

   Model the relationships among problems, sources, ideas, experiments, specifications, tasks, agents, model calls, repositories, commits, artifacts, releases, costs, and revenue. Relationships are many-to-many: one idea can produce multiple products; a product may combine several ideas; one component can be reused by multiple products.

   The interface should answer questions such as:

   - Which products came from this idea, including later forks?
   - Which source supported this decision, and when was it checked?
   - What did each model, sandbox, repository, and deployment contribute?
   - What changed last Tuesday, who initiated it, and which commit contains it?
   - How much did this product cost, including abandoned attempts and shared expenses?
   - Why did the router select a particular model?
   - Which earnings funded the next experiment?

   Support exact IDs, full-text search, filters, saved queries, semantic discovery, and natural-language questions over permitted structured queries. Answers link to records and disclose missing evidence or stale indexing. Source content, code artifacts, screenshots, and decision summaries have different retention and indexing policies; unavailable or deleted data is labeled, not invented.

   Record timestamps, causal links, actor identity, action scope, exact artifact/commit references, and outcome. Maintain append-only audit events with correction records and externally checkpointed integrity digests. This is tamper-evident under defined assumptions, not tamper-proof against every administrator. Sensitive payloads can be redacted or deleted with a retained tombstone and without exposing secrets in search.

9. **GitHub automation operates through your account with clear ownership.**

   Once connected and granted a policy, agents can create private project repositories, initialize approved templates, open issues, create branches, push scoped changes, open pull requests, inspect checks, and prepare releases. Repository names can use a prefix such as creator-agent-, with count and creation-rate limits. Existing personal and school repositories stay outside that grant unless explicitly included.

   Personal repository creation and routine repository work require endpoint-supported authorization paths. The implementation guide specifies both paths and their permission checks. [GitHub repository creation](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user)

   A broker keeps credentials out of the agents' prompts and generated products. After creating a repository, verify that the installation can access it; selected-repository installations may need a scope update. If that authorization is unavailable, preserve completed local work and show the specific connection step required. Expired or revoked access cannot trigger a fallback to a broader credential.

   Merges operate on the exact reviewed head and required checks. Making a repository public, deleting or transferring it, changing access rules, or granting new collaborators requires a separate grant. GitHub and the studio both retain useful history; studio events link the external objects to their originating work.

10. **Quality gates determine when products become available.**

   A prototype must start from its exported package, execute its core workflow, persist expected data, handle important errors, and match its tested version. Review happens independently of implementation; browser evidence supplements language-appropriate tests. A changed candidate invalidates affected verification. Native desktop behavior requires native verification, not only a browser screenshot.

   Keep separate labels for idea, experiment, prototype ready, release candidate, released, and maintained. Auto-repair stops after a bounded number of attempts or exhausted resources, with a checkpoint. Production release adds operational configuration, applicable dependency/license checks, monitoring, rollback, and a support plan.

   Generated code executes in restricted worker environments with test data. It has no access to studio credentials, your personal browser session, unrestricted host files, or the control service. Previews use a separate origin. No product runtime can mint its own funds or expand its tool permissions.

11. **Marketing, learning, and maintenance extend the studio.**

   Marketing begins with evidence-backed positioning, landing pages, demonstrations, and proposed experiments. An enabled delivery integration can send or publish content covered by a standing campaign grant, recipient/audience rules, a content version, and a spending cap. Unknown recipients and changed claims require a new decision. Track suppressions and opt-outs. No fabricated testimonials or synthetic customer validation.

   Payments attach to verified product releases and real customer entitlements. Begin with hosted checkout so the generated application does not handle raw card data. Payment state is verified on the backend. Revenue analytics and reinvestment derive from reconciled financial records, not a success page or an agent's claim.

   Agents can propose reusable components, new skills, prompt improvements, and more efficient workflows. Each proposal carries provenance, permitted uses, evaluation results, and a version. Changes to runtime policy, credential handling, and finance enforcement require trusted review. The system can improve its procedures without modifying its own authority.

   Additional recommended features are portfolio-level maintenance capacity, a reserve-only conservation mode, experiment outcome tracking, source freshness alerts, cancellation checkpoints, cost forecasts with uncertainty, change-impact links, and exportable audit packages. Projects should slow or stop when support obligations exceed available capacity.

12. **Delivery proceeds through usable milestones.**

| Checkpoint | Outcome | Coding prompts |
| --- | --- | --- |
| Foundation | Authenticated catalog, audit events, ledger, one durable agent run | 00–10 |
| Product studio | Discovery, brainstorming, planning, build, test, preview, feedback | 11–21 |
| Efficiency | Benchmarks, model registry, automatic routing, context optimization | 22–27 |
| Traceability and GitHub | Full search, lineage, account connection, repository and PR lifecycle | 28–32 |
| Desktop | Native app and paired local workers | 33–34 |
| Financed operation | Revenue ingestion, checkout, reinvestment, conservation scheduling | 35–38 |
| Distribution and reuse | Marketing drafts, permitted campaigns, reviewed reusable skills | 39–41 |
| Operating release | Deployment, recovery, security, performance, acceptance, pilot | 42–47 |

   The expanded scope is larger than the original outline. Budget roughly 10–18 focused developer-weeks for a dependable personal research/build studio with search and routing, and another 6–12 for full GitHub, desktop, revenue, reinvestment, marketing, and operational hardening. These are planning ranges with overlap, not additive promises per prompt; part-time work may take much longer. A narrow demonstration should appear well before the full scope is complete.

   Initial operating assumptions remain three concurrent model jobs, one active build, two repair cycles, and a $300 monthly pilot envelope. Use actual provider quotes and measured task costs during setup. Success is a repeatable path from evidence to a tested product, with understandable cost and history. Revenue and increased autonomous throughput are subsequent measured outcomes.
