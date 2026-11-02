import type {
  PlanAdmissionRequest,
  PlanConnection,
  PlanModelAccess,
  PlanQualification,
  PlanVerificationGrant,
} from '@creator/contracts';
import {
  CLAUDE_CODE_MIN_VERSION,
  claudeCodeVersionSupported,
  pathForTaskClass,
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
}

/** Reasons the connection as a whole cannot serve inference now, independent of a request. */
export function connectionBlockers(c: PlanConnection): string[] {
  if (c.kind === 'claude_code') return claudeCodeBlockers(c);
  const out: string[] = [];
  if (c.sign_in.state !== 'signed_in')
    out.push(
      c.sign_in.state === 'reauthorization_required'
        ? 'Sign in with ChatGPT again: the saved authorization stopped working.'
        : 'Not signed in with ChatGPT.',
    );
  else if (!c.sign_in.plan_usage_granted)
    out.push(
      'ChatGPT plan usage was not granted at sign-in (chatgpt.tokens.use.direct is missing).',
    );
  if (c.credits.state !== 'confirmed_off')
    out.push(
      'Credits after the plan limit are not confirmed off for Creator Agent in ChatGPT Settings > Usage.',
    );
  if (!c.caps_accepted_at)
    out.push(
      'The owner has not accepted the current caps and allowed work (request, daily, time and output caps; data and task classes).',
    );
  if (c.eligibility.state === 'not_eligible')
    out.push(
      `OpenAI reported this account or app as not eligible for plan usage (${c.eligibility.reason_code ?? 'no code'}).`,
    );
  if (c.quota.state === 'exhausted')
    out.push(
      'The ChatGPT plan usage limit was reached. Plan requests pause; check ChatGPT Settings > Usage.',
    );
  return out;
}

/**
 * ADR-0050: the owner's own Claude Code CLI. "Signed in" is the last `claude auth status`
 * check the studio ran; it only counts when Claude Code reported a claude.ai subscription
 * login, because an API key or other credential would bill elsewhere.
 */
/** The CLI version the last check recorded (`claude-code/<version>`). */
const claudeCodeVersion = (c: PlanConnection) =>
  c.sign_in.issued_client_id?.replace(/^claude-code\//, '') ?? '';

function claudeCodeBlockers(c: PlanConnection): string[] {
  const out: string[] = [];
  if (c.sign_in.state !== 'signed_in')
    out.push(
      c.sign_in.state === 'reauthorization_required'
        ? "Claude Code on this computer stopped accepting its sign-in. Run claude auth login in the studio's Claude Code folder, then check again."
        : 'Claude Code on this computer has not been checked, or is not signed in. Sign in with claude auth login, then check again.',
    );
  else if (!claudeCodeVersionSupported(claudeCodeVersion(c)))
    out.push(
      `Claude Code ${claudeCodeVersion(c) || '(unknown version)'} is older than ${CLAUDE_CODE_MIN_VERSION}, which the studio needs for its locked-down runs. Run claude update, then check again.`,
    );
  else if (!c.sign_in.plan_usage_granted)
    out.push(
      'Claude Code is using an API key or another credential, not your Claude subscription. Remove it and sign in with your Claude account.',
    );
  if (c.credits.state !== 'confirmed_off')
    out.push(
      'Extra usage after the Claude plan limit is not confirmed off in Claude Settings > Usage.',
    );
  if (!c.caps_accepted_at)
    out.push(
      'The owner has not accepted the current caps and allowed work (request, daily, time and output caps; data and task classes).',
    );
  if (c.eligibility.state === 'not_eligible')
    out.push(
      `Claude reported this account as unable to use Claude Code (${c.eligibility.reason_code ?? 'no code'}).`,
    );
  if (c.quota.state === 'exhausted')
    out.push(
      'The Claude plan usage limit was reached. Requests pause until it resets; check Claude Settings > Usage.',
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

export function admissionBlockers(input: {
  connection: PlanConnection;
  request: PlanAdmissionRequest;
  access: PlanModelAccess[];
  qualifications: PlanQualification[];
  grant: PlanVerificationGrant | null;
  usage: PlanUsageCounts;
  now: Date;
  /** ADR-0057: the workspace's chat setting and today's chat answers on this connection. */
  chat?: PlanChatAllowance | null | undefined;
}): string[] {
  const { connection: c, request: r, usage: u } = input;
  const caps = c.settings.caps;
  const out = connectionBlockers(c);
  if (c.kind === 'claude_code' && r.path !== 'responses')
    out.push(
      'Claude Code connections have the direct path only (no Codex builds).',
    );
  if (!c.settings.allowed_data_classes.includes(r.data_class))
    out.push(`Data class ${r.data_class} is not allowed on this connection.`);
  if (r.task_class && !c.settings.allowed_task_classes.includes(r.task_class))
    out.push(`Task class ${r.task_class} is not allowed on this connection.`);
  if (r.task_class && pathForTaskClass(r.task_class) !== r.path)
    out.push('This task class belongs to the other path.');
  if (u.unresolved > 0)
    out.push(
      'An earlier plan request has an unknown outcome; reconcile it first.',
    );
  if (u.in_flight >= caps.shared.max_in_flight)
    out.push('Another plan request is already running (one at a time).');
  if (u.last_24h_requests >= caps.shared.max_model_requests_per_day)
    out.push('The studio daily request cap for this connection is reached.');
  if (r.path === 'responses') {
    if (r.input_chars > caps.responses.max_input_chars)
      out.push('The request input is larger than the per-request input cap.');
    if (r.run_id && u.run_requests >= caps.responses.max_requests_per_run)
      out.push('The per-run request cap is reached.');
  } else if (u.build_requests >= caps.codex.max_model_requests_per_build)
    out.push('The per-build Codex model request cap is reached.');
  const verified = input.access.some(
    (a) =>
      a.model_id === r.model_id && a.path === r.path && a.access === 'verified',
  );
  switch (r.purpose) {
    case 'verification':
    case 'availability_recheck': {
      const g = input.grant;
      if (!g || g.id !== r.grant_id || g.connection_id !== c.id)
        out.push('The one-shot verification approval was not found.');
      else {
        const intent =
          r.purpose === 'verification'
            ? 'model_access'
            : 'availability_recheck';
        if ((g.intent ?? 'model_access') !== intent)
          out.push('The one-shot approval is for another check intent.');
        if (g.model_id !== r.model_id || g.path !== r.path)
          out.push('The verification approval is for another model or path.');
        if (g.used >= g.max_requests)
          out.push('The verification approval was already used.');
        if (Date.parse(g.expires_at) <= input.now.getTime())
          out.push('The verification approval has expired.');
      }
      if (r.purpose === 'verification' && verified)
        out.push('This model is already verified on this path.');
      if (r.purpose === 'availability_recheck' && !verified)
        out.push('Verify model access before rechecking availability.');
      break;
    }
    case 'qualification': {
      if (!verified) out.push('Verify model access before qualifying it.');
      const q = input.qualifications.find((x) => x.id === r.qualification_id);
      if (!q || q.state !== 'running' || q.model_id !== r.model_id)
        out.push('The qualification run is not open for this model.');
      break;
    }
    case 'chat': {
      if (!verified)
        out.push(
          `Model ${r.model_id} has no verified access on this connection.`,
        );
      const chat = input.chat;
      if (!chat?.enabled)
        out.push('Chat answers are turned off for this workspace.');
      else if (chat.connection_id !== c.id || chat.model_id !== r.model_id)
        out.push(
          'Chat answers are set to use another connection or model; this one is not allowed.',
        );
      else if (chat.used_24h >= chat.daily_limit)
        out.push(
          `The daily chat limit (${chat.daily_limit} answers in 24 hours) is reached.`,
        );
      if (chat?.study_open)
        out.push(
          'A study attempt is open in this workspace, so chat answers are paused until it finishes.',
        );
      break;
    }
    case 'task':
    case 'codex_build': {
      if (!verified)
        out.push(
          `Model ${r.model_id} has no verified access on the ${r.path} path.`,
        );
      const qualified =
        r.task_class !== null &&
        input.qualifications.some(
          (q) =>
            q.model_id === r.model_id &&
            q.task_class === r.task_class &&
            q.state === 'qualified',
        );
      if (!qualified)
        out.push(
          `Model ${r.model_id} is not qualified for ${r.task_class ?? 'this task'} on this connection.`,
        );
      if (
        r.purpose === 'codex_build' &&
        u.build_requests === 0 &&
        u.last_24h_codex_builds >= caps.codex.max_builds_per_day
      )
        out.push('The daily Codex build cap is reached.');
      break;
    }
  }
  return [...new Set(out)];
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
    reason: `${q.held_out.passed}/${q.held_out.total} held-out cases accepted against a floor of ${q.floor.numerator}/${q.floor.denominator} (absolute, not baseline-relative).`,
  };
}
