import {
  ThemeIntentBodySchema,
  ThemeResearchPlanSchema,
} from '@creator/contracts';

/** Preparation is deterministic and carries no execution authority. */
export function prepareThemeResearchPlan(intent: {
  id: string;
  workspace_id: string;
  version: number;
  content_hash: string;
  body: unknown;
}) {
  const body = ThemeIntentBodySchema.parse(intent.body);
  return ThemeResearchPlanSchema.parse({
    format: 'theme-research-plan/1',
    workspace_id: intent.workspace_id,
    intent: {
      id: intent.id,
      version: intent.version,
      content_hash: intent.content_hash,
    },
    questions: body.questions.length
      ? body.questions
      : [
          'Who is affected, and what current problem can be observed?',
          'What do the supplied sources support, contradict or leave unknown?',
          'Which existing tools, processes or human-led responses should be compared?',
        ],
    source_strategy: body.source_strategy,
    proposed_sources: body.source_urls,
    preparation_limits: {
      provider_requests: 0,
      source_fetches: 0,
      new_metered_spend_nano_usd: '0',
    },
    sharing: 'No data is sent externally by saving or preparing this plan.',
    execution: 'not_authorized',
    native_search: 'not_integrated_account_entitlement_unknown',
    prerequisites: [
      ...(body.source_urls.length
        ? []
        : [
            'Supply public source URLs or identify permitted evidence before collection.',
          ]),
      ...(body.source_strategy === 'approved_direct_fetch'
        ? [
            'Direct retrieval requires an approved host policy and a covering source-fetch grant.',
          ]
        : ['Supplied URLs are proposals, not fetched or verified evidence.']),
      'Record exact supporting passages and contrary evidence before creating claims.',
      'Complete an editable concrete brief; affected users, measurable problem and outcome are not inferred from the theme.',
      'Before any execution, resolve current route qualifications, parent limits, data-sharing scope and covering grants. Execution limits have not been selected by this plan.',
    ],
  });
}
