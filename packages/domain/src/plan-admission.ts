import type {
  PlanAdmissionRequest,
  PlanCaps,
  PlanConnection,
  PlanModelAccess,
  PlanQualification,
  PlanRefusal,
  PlanRefusalCode,
  PlanVerificationGrant,
} from '@creator/contracts';
import {
  CLAUDE_CODE_MIN_VERSION,
  claudeCodeVersionSupported,
  pathForTaskClass,
  isQualified,
  PLAN_RECONCILE_HINT,
  PLAN_EXTRA_HOURS,
  PLAN_EXTRA_REQUESTS,
} from '@creator/contracts';

// Deterministic admission for ChatGPT-plan requests (§2.4). The store evaluates this under a
// row lock with the counts it just read; a model never supplies any of these facts.

export interface PlanUsageCounts {
  /** Upstream model requests started in the last 24 hours, both paths. */
  last_24h_requests: number;
  last_24h_codex_builds: number;
  /** Requests of this run on the responses path (any purpose). */
  run_requests: number;
  /** Upstream requests already made by this Codex build. */
  build_requests: number;
  in_flight: number;
  /** Requests whose outcome is still unknown: they block new dispatch until reconciled. */
  unresolved: number;
  /**
   * ADR-0094: extra requests the owner granted on top of the daily cap that have not expired.
   * Counted from the store's own rows; a model never supplies it.
   */
  extra_requests: number;
}

/** The daily request cap admission uses now: the configured cap plus unexpired extras. */
export const dailyCap = (
  caps: PlanCaps,
  u: Pick<PlanUsageCounts, 'extra_requests'>,
) => caps.shared.max_model_requests_per_day + u.extra_requests;

/** One refusal with its stable code (ADR-0087) and the facts a fix needs. */
const refusal = (
  code: PlanRefusalCode,
  text: string,
  extra: Omit<PlanRefusal, 'code' | 'text'> = {},
): PlanRefusal => ({ code, text, ...extra });

/** Reasons the connection as a whole cannot serve inference now, independent of a request. */
export function connectionBlockers(c: PlanConnection): string[] {
  return connectionRefusals(c).map((r) => r.text);
}

/** The same reasons, each with its code and the connection it names (ADR-0087). */
export function connectionRefusals(c: PlanConnection): PlanRefusal[] {
  const out =
    c.kind === 'claude_code' ? claudeCodeRefusals(c) : chatgptRefusals(c);
  return out.map((r) => ({ ...r, connection_id: c.id }));
}

function chatgptRefusals(c: PlanConnection): PlanRefusal[] {
  const out: PlanRefusal[] = [];
  if (c.sign_in.state !== 'signed_in')
    out.push(
      refusal(
        'sign_in',
        c.sign_in.state === 'reauthorization_required'
          ? 'Sign in with ChatGPT again: the saved authorization stopped working.'
          : 'Not signed in with ChatGPT.',
      ),
    );
  else if (!c.sign_in.plan_usage_granted)
    out.push(
      refusal(
        'sign_in',
        'ChatGPT plan usage was not granted at sign-in (chatgpt.tokens.use.direct is missing).',
      ),
    );
  if (c.credits.state !== 'confirmed_off')
    out.push(
      refusal(
        'credits_not_off',
        'Credits after the plan limit are not confirmed off for Creator Agent in ChatGPT Settings > Usage.',
      ),
    );
  if (!c.caps_accepted_at) out.push(capsNotAccepted());
  if (c.eligibility.state === 'not_eligible')
    out.push(
      refusal(
        'not_eligible',
        `OpenAI reported this account or app as not eligible for plan usage (${c.eligibility.reason_code ?? 'no code'}).`,
      ),
    );
  if (c.quota.state === 'exhausted')
    out.push(
      refusal(
        'quota_exhausted',
        'The ChatGPT plan usage limit was reached. Plan requests pause; check ChatGPT Settings > Usage.',
      ),
    );
  return out;
}

const capsNotAccepted = () =>
  refusal(
    'caps_not_accepted',
    'The owner has not accepted the current caps and allowed work (request, daily, time and output caps; data and task classes).',
  );

/**
 * ADR-0050: the owner's own Claude Code CLI. "Signed in" is the last `claude auth status`
 * check the studio ran; it only counts when Claude Code reported a claude.ai subscription
 * login, because an API key or other credential would bill elsewhere.
 */
/** The CLI version the last check recorded (`claude-code/<version>`). */
const claudeCodeVersion = (c: PlanConnection) =>
  c.sign_in.issued_client_id?.replace(/^claude-code\//, '') ?? '';

function claudeCodeRefusals(c: PlanConnection): PlanRefusal[] {
  const out: PlanRefusal[] = [];
  if (c.sign_in.state !== 'signed_in')
    out.push(
      refusal(
        'sign_in',
        c.sign_in.state === 'reauthorization_required'
          ? "Claude Code on this computer stopped accepting its sign-in. Run claude auth login in the studio's Claude Code folder, then check again."
          : 'Claude Code on this computer has not been checked, or is not signed in. Sign in with claude auth login, then check again.',
      ),
    );
  else if (!claudeCodeVersionSupported(claudeCodeVersion(c)))
    out.push(
      refusal(
        'sign_in',
        `Claude Code ${claudeCodeVersion(c) || '(unknown version)'} is older than ${CLAUDE_CODE_MIN_VERSION}, which the studio needs for its locked-down runs. Run claude update, then check again.`,
      ),
    );
  else if (!c.sign_in.plan_usage_granted)
    out.push(
      refusal(
        'sign_in',
        'Claude Code is using an API key or another credential, not your Claude subscription. Remove it and sign in with your Claude account.',
      ),
    );
  if (c.credits.state !== 'confirmed_off')
    out.push(
      refusal(
        'credits_not_off',
        'Extra usage after the Claude plan limit is not confirmed off in Claude Settings > Usage.',
      ),
    );
  if (!c.caps_accepted_at) out.push(capsNotAccepted());
  if (c.eligibility.state === 'not_eligible')
    out.push(
      refusal(
        'not_eligible',
        `Claude reported this account as unable to use Claude Code (${c.eligibility.reason_code ?? 'no code'}).`,
      ),
    );
  if (c.quota.state === 'exhausted')
    out.push(
      refusal(
        'quota_exhausted',
        'The Claude plan usage limit was reached. Requests pause until it resets; check Claude Settings > Usage.',
      ),
    );
  return out;
}

/** The owner's chat setting as admission sees it (ADR-0057). */
export interface PlanChatAllowance {
  enabled: boolean;
  connection_id: string | null;
  model_id: string | null;
  daily_limit: number;
  /** Chat requests started on this connection in the last 24 hours. */
  used_24h: number;
  /**
   * Review L-3: a study attempt in this workspace is still open on an active run. Chat answers
   * stay off then, so a model cannot reach into a frozen (for example human-only) study arm.
   */
  study_open?: boolean;
}

type AdmissionInput = {
  connection: PlanConnection;
  request: PlanAdmissionRequest;
  access: PlanModelAccess[];
  qualifications: PlanQualification[];
  grant: PlanVerificationGrant | null;
  usage: PlanUsageCounts;
  now: Date;
  /** ADR-0057: the workspace's chat setting and today's chat answers on this connection. */
  chat?: PlanChatAllowance | null | undefined;
};

export function admissionBlockers(input: AdmissionInput): string[] {
  return admissionRefusals(input).map((r) => r.text);
}

/**
 * Every reason a request is refused, each with its stable code (ADR-0087) and the connection,
 * model and class it names, so the app can offer that refusal's fix. Same order and wording as
 * `admissionBlockers`; a repeated sentence is listed once.
 */
export function admissionRefusals(input: AdmissionInput): PlanRefusal[] {
  const { connection: c, request: r, usage: u } = input;
  const caps = c.settings.caps;
  const out: PlanRefusal[] = [];
  const push = (
    code: PlanRefusalCode,
    text: string,
    extra: Omit<PlanRefusal, 'code' | 'text'> = {},
  ) => out.push({ ...refusal(code, text, extra), connection_id: c.id });
  out.push(...connectionRefusals(c));
  if (c.kind === 'claude_code' && r.path !== 'responses')
    push(
      'wrong_path',
      'Claude Code connections have the direct path only (no Codex builds).',
    );
  if (!c.settings.allowed_data_classes.includes(r.data_class))
    push(
      'data_class_not_allowed',
      `Data class ${r.data_class} is not allowed on this connection.`,
      { data_class: r.data_class },
    );
  if (r.task_class && !c.settings.allowed_task_classes.includes(r.task_class))
    push(
      'task_class_not_allowed',
      `Task class ${r.task_class} is not allowed on this connection.`,
      { task_class: r.task_class, model_id: r.model_id },
    );
  if (r.task_class && pathForTaskClass(r.task_class) !== r.path)
    push('wrong_path', 'This task class belongs to the other path.');
  if (u.unresolved > 0)
    push(
      'request_open',
      `An earlier plan request has an unknown outcome; ${PLAN_RECONCILE_HINT}.`,
    );
  if (u.in_flight >= caps.shared.max_in_flight)
    push(
      'request_open',
      `Another plan request is already running (one at a time). If the studio stopped during it, ${PLAN_RECONCILE_HINT}.`,
    );
  if (u.last_24h_requests >= dailyCap(caps, u))
    push(
      'daily_cap_reached',
      u.extra_requests > 0
        ? `The studio daily request cap for this connection is reached, including ${u.extra_requests} extra requests. The owner can add ${PLAN_EXTRA_REQUESTS} more for the next ${PLAN_EXTRA_HOURS} hours.`
        : `The studio daily request cap for this connection is reached. The owner can add ${PLAN_EXTRA_REQUESTS} more for the next ${PLAN_EXTRA_HOURS} hours.`,
    );
  if (r.path === 'responses') {
    if (r.input_chars > caps.responses.max_input_chars)
      push(
        'cap_reached',
        'The request input is larger than the per-request input cap.',
      );
    if (r.run_id && u.run_requests >= caps.responses.max_requests_per_run)
      push('cap_reached', 'The per-run request cap is reached.');
  } else if (u.build_requests >= caps.codex.max_model_requests_per_build)
    push('cap_reached', 'The per-build Codex model request cap is reached.');
  const verified = input.access.some(
    (a) =>
      a.model_id === r.model_id && a.path === r.path && a.access === 'verified',
  );
  switch (r.purpose) {
    case 'verification':
    case 'availability_recheck': {
      const g = input.grant;
      if (!g || g.id !== r.grant_id || g.connection_id !== c.id)
        push('grant', 'The one-shot verification approval was not found.');
      else {
        const intent =
          r.purpose === 'verification'
            ? 'model_access'
            : 'availability_recheck';
        if ((g.intent ?? 'model_access') !== intent)
          push('grant', 'The one-shot approval is for another check intent.');
        if (g.model_id !== r.model_id || g.path !== r.path)
          push(
            'grant',
            'The verification approval is for another model or path.',
          );
        if (g.used >= g.max_requests)
          push('grant', 'The verification approval was already used.');
        if (Date.parse(g.expires_at) <= input.now.getTime())
          push('grant', 'The verification approval has expired.');
      }
      if (r.purpose === 'verification' && verified)
        push('other', 'This model is already verified on this path.');
      if (r.purpose === 'availability_recheck' && !verified)
        push(
          'not_verified',
          'Verify model access before rechecking availability.',
          { model_id: r.model_id },
        );
      break;
    }
    case 'qualification': {
      if (!verified)
        push('not_verified', 'Verify model access before qualifying it.', {
          model_id: r.model_id,
        });
      const q = input.qualifications.find((x) => x.id === r.qualification_id);
      if (!q || q.state !== 'running' || q.model_id !== r.model_id)
        push('other', 'The qualification run is not open for this model.');
      break;
    }
    case 'chat': {
      if (!verified)
        push(
          'not_verified',
          `Model ${r.model_id} has no verified access on this connection.`,
          { model_id: r.model_id },
        );
      const chat = input.chat;
      if (!chat?.enabled)
        push('chat_setting', 'Chat answers are turned off for this workspace.');
      else if (chat.connection_id !== c.id || chat.model_id !== r.model_id)
        push(
          'chat_setting',
          'Chat answers are set to use another connection or model; this one is not allowed.',
        );
      else if (chat.used_24h >= chat.daily_limit)
        push(
          'cap_reached',
          `The daily chat limit (${chat.daily_limit} answers in 24 hours) is reached.`,
        );
      if (chat?.study_open)
        push(
          'other',
          'A study attempt is open in this workspace, so chat answers are paused until it finishes.',
        );
      break;
    }
    case 'task':
    case 'codex_build': {
      if (!verified)
        push(
          'not_verified',
          `Model ${r.model_id} has no verified access on the ${r.path} path.`,
          { model_id: r.model_id },
        );
      // The newest decided qualification counts: a later failure withdraws a pass.
      const qualified =
        r.task_class !== null &&
        isQualified(input.qualifications, r.model_id, r.task_class);
      if (!qualified)
        push(
          'not_qualified',
          `Model ${r.model_id} is not qualified for ${r.task_class ?? 'this task'} on this connection.`,
          {
            model_id: r.model_id,
            ...(r.task_class ? { task_class: r.task_class } : {}),
          },
        );
      if (
        r.purpose === 'codex_build' &&
        u.build_requests === 0 &&
        u.last_24h_codex_builds >= caps.codex.max_builds_per_day
      )
        push('cap_reached', 'The daily Codex build cap is reached.');
      break;
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.text) && Boolean(seen.add(x.text)));
}

/**
 * Qualification decision: held-out pass rate at or above the floor, with at least the minimum
 * number of held-out cases. Development cases are reported but never decide.
 */
export function qualificationDecision(q: {
  held_out: { passed: number; total: number };
  min_held_out_cases: number;
  floor: { numerator: number; denominator: number };
}): { qualified: boolean; reason: string } {
  if (q.held_out.total < q.min_held_out_cases)
    return {
      qualified: false,
      reason: `Only ${q.held_out.total} held-out cases ran; ${q.min_held_out_cases} are required.`,
    };
  const ok =
    q.held_out.passed * q.floor.denominator >=
    q.floor.numerator * q.held_out.total;
  return {
    qualified: ok,
    // Live check, November 11: "a floor of 1/1" read as one case; say how many were needed.
    reason: `${q.held_out.passed}/${q.held_out.total} held-out cases accepted; ${Math.ceil((q.floor.numerator * q.held_out.total) / q.floor.denominator)} of ${q.held_out.total} were needed (absolute, not baseline-relative).`,
  };
}
