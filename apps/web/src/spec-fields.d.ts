export type Method = '' | 'automated_test' | 'browser_check' | 'manual_review' | 'metric';
export type Role = '' | 'builder' | 'reviewer' | 'qa' | 'designer' | 'owner';
export type DataClass = '' | 'synthetic' | 'public' | 'private_approved';
export type CaseDraft = {
    /** One argument per line, exactly as typed (an empty middle line is an empty argument). */
    args: string;
    /**
     * The stored arguments when revising: kept exactly while `args` is not edited, so a list the
     * one-per-line box can't show (an argument with a line break, or a final empty argument) is
     * never rewritten by a revision that doesn't touch it (review of PR #112, M-2).
     */
    stored?: string[];
    stdin: string;
    /** Expected output without its final newline; `newline` adds it back. */
    stdout: string;
    newline: boolean;
    exit_code: string;
    held_out: boolean;
};
/**
 * ADR-0078: a browser case as the form edits it. Steps are typed one per line (see
 * BROWSER_STEP_HELP in the contracts); `stored` keeps a revised case's exact steps while the
 * text still shows them.
 */
export type BrowserCaseDraft = {
    page: string;
    steps: string;
    stored?: {
        text: string;
        steps: unknown[];
    };
    held_out: boolean;
};
/** Parses typed steps; the form passes the contracts' parseBrowserSteps (this file has no imports). */
export type StepParser = (text: string) => {
    steps: unknown[];
} | {
    error: string;
};
export type SpecDraft = {
    title: string;
    audience: string;
    problem_statement: string;
    flows: {
        key: string;
        name: string;
        steps: string;
    }[];
    scope: string;
    non_goals: string;
    data_contracts: {
        name: string;
        description: string;
        data_class: DataClass;
    }[];
    checks: {
        key: string;
        flow: string;
        statement: string;
        measure: string;
        method: Method;
        cases: CaseDraft[];
        browser_cases: BrowserCaseDraft[];
    }[];
    risks: {
        risk: string;
        mitigation: string;
    }[];
    maintenance: {
        owner: string;
        obligations: string;
        review_interval: string;
    };
    tasks: {
        key: string;
        title: string;
        role: Role;
        file_scope: string;
        depends_on: string[];
        acceptance: string[];
        deliverable: string;
    }[];
};
type Case = {
    args: string[];
    stdin: string;
    stdout: string;
    exit_code: number;
    held_out: boolean;
};
type BrowserCase = {
    page: string;
    steps: unknown[];
    held_out: boolean;
};
export type SpecContentShape = {
    audience: string;
    problem_statement: string;
    user_flows: {
        key: string;
        name: string;
        steps: string[];
    }[];
    scope: string[];
    non_goals: string[];
    data_contracts: {
        name: string;
        description: string;
        data_class: 'synthetic' | 'public' | 'private_approved';
    }[];
    acceptance_checks: {
        key: string;
        flow: string | null;
        statement: string;
        measure: string;
        method: 'automated_test' | 'browser_check' | 'manual_review' | 'metric';
        cases?: Case[];
        browser_cases?: BrowserCase[];
    }[];
    risks: {
        risk: string;
        mitigation: string;
    }[];
    maintenance: {
        owner: string;
        obligations: string[];
        review_interval: string;
    };
    tasks: {
        key: string;
        title: string;
        role: 'builder' | 'reviewer' | 'qa' | 'designer' | 'owner';
        file_scope: string[];
        depends_on: string[];
        acceptance: string[];
        deliverable: string;
    }[];
};
/**
 * The next key with this prefix (F, A or T), after the highest one in use or stored in the
 * version being revised: keys stay fixed once given and a removed key is never reused, so a
 * revision's task changes read as "removed T2, added T3" (review of PR #112, L-1).
 */
export declare function nextKey(prefix: 'F' | 'A' | 'T', used: readonly string[], stored?: readonly string[]): string | null;
/** True when the one-per-line box shows these arguments exactly. */
export declare const argsShowable: (args: readonly string[]) => boolean;
/** Every key a stored spec version gave out, for nextKey in a revision. */
export declare function storedKeys(s: SpecContentShape): string[];
type Ref = {
    id: string;
    version: number;
};
/**
 * Options a current selection chose for build that have no active spec written from that
 * selection. A spec belongs to the selection it was written from: once the owner records the
 * selection again, the old spec can no longer be frozen, so the option is offered again
 * (review of PR #112, M-1).
 */
export declare function unwrittenOptions<T extends {
    selection_id: string;
    alternative: Ref;
}>(selections: readonly T[], specs: readonly {
    status: string;
    body: Record<string, unknown> | null;
}[]): T[];
export declare const emptyBrowserCase: () => BrowserCaseDraft;
export declare const emptyCase: () => CaseDraft;
/**
 * ADR-0082 (P19): the routine values a new spec starts with, shown under their folds with
 * "studio default" until changed. They describe how the work is organised and kept up, never
 * what it must do: flows, scope, checks and cases are always the person's own.
 */
export declare const SPEC_DEFAULTS: {
    role: Role;
    obligations: string;
    review_interval: string;
};
export declare function emptySpecDraft(prefill?: {
    title?: string;
    audience?: string;
    problem_statement?: string;
    /** Who writes the spec; the default maintainer. */
    maintainer?: string;
}): SpecDraft;
/** A stored (or model-suggested) case, as the form edits it. */
export declare function caseDraft(c: Case): CaseDraft;
/** A stored (or model-suggested) browser case, as the form edits it. */
export declare function browserCaseDraft(c: BrowserCase, formatStep?: (step: unknown) => string): BrowserCaseDraft;
/** A stored spec version, as the form edits it when revising. */
export declare function draftFromContent(title: string, s: SpecContentShape, 
/** Turns a stored browser step back into its typed line (formatBrowserStep). */
formatStep?: (step: unknown) => string): SpecDraft;
/** The spec content and title, or the fields to fix (keyed like `checks.0.statement`). */
export declare function draftToContent(d: SpecDraft, 
/** Required for browser cases; without it any browser case is reported as an error. */
parseSteps?: StepParser): {
    title: string;
    content: SpecContentShape;
    errors: null;
} | {
    title: null;
    content: null;
    errors: Record<string, string>;
};
/**
 * Why the studio's reviewed Python builder could not build a task of this spec, in words
 * (packages/executor/src/build.ts). Advice only: a spec can be valid and still need another
 * recipe; the build itself checks again.
 */
export declare function buildNotes(s: SpecContentShape): string[];
/**
 * The reason a spec revision from preview feedback starts with. The studio appends
 * " (feedback <id>)" and keeps 300 characters, so the feedback's own words are cut at 240.
 */
export declare function feedbackReason(text: string): string;
/**
 * Why accepted preview feedback cannot open the spec form now, in words, or null when it
 * can. The feedback names the spec version it was given on; the studio refuses a revision
 * once that spec has moved on, so the form is not offered for it (audit L-8).
 */
export declare function feedbackRevisionBlocker(f: {
    status: string;
    spec: {
        version: number;
    };
}, spec: {
    status: string;
    version: number;
    format: unknown;
}, owner: boolean): string | null;
/**
 * The longest reason a feedback revision takes: the studio appends " (feedback <uuid>)"
 * (48 characters) and keeps 300, so a longer reason would cut the feedback id off (PR #121
 * review N-1).
 */
export declare const FEEDBACK_REASON_MAX = 252;
/**
 * A package's accepted feedback can start one spec revision: the first one moves the spec on
 * and the others are given on a superseded version. Says so for an accepted item once another
 * item of the same package has revised the spec, so it is known without a click (PR #121
 * review L-1).
 */
export declare function feedbackSuperseded(f: {
    id: string;
    status: string;
    spec: {
        version: number;
    };
}, all: readonly {
    id: string;
    revision: {
        version: number;
    } | null;
}[]): string | null;
/** Shown when the spec or the feedback moved on while the revision form was open (L-2). */
export declare const FEEDBACK_REVISION_STALE = "The spec changed after this form opened (another revision was saved), so this feedback can no longer revise it. Your edits here were not saved. Make the change in the current version on Build.";
/**
 * ADR-0107 (B2): one acceptance check of the form as an edge-case or explanation request sends
 * it, with the form's own rules applied to its cases (the rest of the form may still be
 * incomplete), or the first problem to fix. The scope lines go with it: they are the rules a
 * case follows.
 */
export declare function checkForDraft(d: SpecDraft, i: number, parseSteps?: StepParser): {
    check: {
        key: string;
        statement: string;
        measure: string;
        method: 'automated_test' | 'browser_check';
        cases: Case[];
        browser_cases: BrowserCase[];
        scope: string[];
    };
    error: null;
} | {
    check: null;
    error: string;
};
/** Where a case problem shows in the form: the case's field key, else the check's. */
export declare function problemKey(p: {
    check: string;
    list: 'cases' | 'browser_cases' | null;
    index: number | null;
}, checkKeys: readonly string[]): string | null;
/**
 * The route a draft goes to: the person's current model when it may draft specs, else the
 * first route that may. Never a route the server did not list.
 */
export declare function draftRoute<R extends {
    connection_id: string;
    model_id: string;
}>(routes: readonly R[], choice: {
    connection_id: string;
    model_id: string;
} | null, picked: string | null): R | null;
export {};
