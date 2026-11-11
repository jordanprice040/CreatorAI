// P20 browser walk (ADR-0083): from an empty fixture workspace to a scored option, a recorded
// choice and a saved proposal using only Chat. Every step is a card the person fills in and
// sends; the card's requests go through the forms' own routes. Also shows a refused card (the
// route's own reason), a stale card (a record changed after it was made) and the audit trail.
// Usage: node walk.cjs <out dir>   (dev servers on 5183/4330/4340, CREATOR_DEV_LOGIN_CODE below)
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:5183';
const CODE = process.env.LOGIN_CODE || 'walkcode_p20_0123456789abcdefghijklmn';
const OUT = process.argv[2] || '.';
const log = [];
const note = (k, v) => {
  log.push({ step: k, value: v });
  console.log(k, JSON.stringify(v));
};
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let WS = null;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1100 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  const formRequests = [];
  const save = () =>
    require('fs').writeFileSync(
      `${OUT}/walk.json`,
      JSON.stringify({ log, errors, formRequests }, null, 2),
    );
  process.on('unhandledRejection', () => undefined);
  const fail = async (e) => {
    note('FAILED', String(e).split('\n')[0]);
    await p
      .screenshot({ path: `${OUT}/failure.png`, fullPage: true })
      .catch(() => undefined);
    save();
    process.exit(1);
  };
  try {
    p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    p.on('response', (r) => {
      if (r.status() >= 400)
        errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    p.on('request', (r) => {
      const h = r.headers();
      if (h['x-causation-id'])
        formRequests.push({
          path: new URL(r.url()).pathname.replace(
            /\/workspaces\/[^/]+/,
            '/workspaces/…',
          ),
          causation: h['x-causation-id'],
          card: h['x-correlation-id'],
        });
    });
    let shotN = 0;
    const shot = async (name, el) => {
      const file = `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`;
      if (el) await el.screenshot({ path: file });
      else await p.screenshot({ path: file, fullPage: false });
    };

    await p.goto(`${B}/#login=${CODE}`);
    await sleep(2500);
    await p.click('text=New workspace');
    const name = `P20 walk ${new Date().toISOString().slice(11, 19)}`;
    await p.fill('input >> nth=0', name);
    await p.click('button:has-text("Create")');
    await sleep(3000);
    WS = new URL(p.url().replace('#/', '')).searchParams.get('ws');
    note('0 workspace', { name, ws: WS });
    const api = (path, body) =>
      p.evaluate(
        async ([path, body]) => {
          const s = await (await fetch('/api/auth/session')).json();
          const r = await fetch(`/api/${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': s.csrf_token,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          return r.json();
        },
        [path, body],
      );

    await p.goto(`${B}/#/chat/conversations?ws=${WS}`);
    await sleep(2500);

    const say = async (text) => {
      await p.fill('#chat-input', text);
      await p.press('#chat-input', 'Enter');
      await sleep(2500);
    };
    const lastTurn = () => p.locator('li.chat-turn:has(.chat-you)').last();
    const card = () => p.locator('.chat-card').last();
    /** Answers each question the card asks with `answers[key]` ('*' = first choice). */
    const fill = async (answers, tag) => {
      const asked = [];
      for (let i = 0; i < 80; i++) {
        const q = card().locator('.chat-card-question');
        if ((await q.count()) === 0) break;
        const key = await q.getAttribute('data-question');
        const prompt = (
          await q.locator('legend, label').first().textContent()
        ).trim();
        asked.push({ key, prompt });
        const a =
          typeof answers === 'function' ? answers(key, prompt) : answers[key];
        if (a === undefined)
          throw new Error(`${tag}: no answer for ${key} (${prompt})`);
        const radios = q.locator('input[type=radio]');
        const boxes = q.locator('input[type=checkbox]');
        if (a === null) {
          await q.locator('button:has-text("Skip")').click();
        } else if (a === '=') {
          // Keep what the card filled in (a hint, the passage's first sentence).
          await q.locator('button:has-text("Next")').click();
        } else {
          if ((await radios.count()) > 0) {
            if (a === '*') await radios.locator('visible=true').first().check();
            else
              await q
                .locator('label.chat-card-choice', { hasText: a })
                .first()
                .locator('input')
                .check();
          } else if ((await boxes.count()) > 0) {
            for (const x of Array.isArray(a) ? a : [a])
              if (x === '*') await boxes.first().check();
              else
                await q
                  .locator('label.chat-card-choice', { hasText: x })
                  .first()
                  .locator('input')
                  .check();
          } else {
            await q.locator('textarea, input').first().fill(a);
          }
          await q.locator('button:has-text("Next")').click();
        }
        await sleep(1200);
      }
      return asked;
    };
    const summary = async () => ({
      title: await card().locator('.chat-card-title').textContent(),
      missing: await card()
        .locator('.chat-card-missing')
        .textContent()
        .catch(() => null),
      blockers: await card()
        .locator('.chat-card-blockers li')
        .allTextContents(),
      happen: (
        await card()
          .locator('.what-happens dl')
          .innerText()
          .catch(() => '')
      ).split('\n'),
      requests: await card()
        .locator('details.chat-sent summary')
        .textContent()
        .catch(() => null),
    });
    const send = async (tag, wait = 4000) => {
      const c = card();
      await c.locator('button:has-text("Send")').first().click();
      await sleep(wait);
      const state = await c.locator('.chat-meta').first().textContent();
      const result = await c
        .locator('.chat-card-result')
        .innerText()
        .catch(() => '');
      note(`${tag} sent`, { state: state.split(' · ').pop(), result });
      return state;
    };
    const doHere = async (tag) => {
      const btn = lastTurn().locator('button:has-text("Do it here")');
      const label = await btn.textContent();
      await btn.click();
      await sleep(2500);
      note(`${tag} button`, label);
    };

    // 1. Evidence: fetch a page.
    await say("What's next?");
    note(
      '1 studio reply',
      await lastTurn().locator('.chat-studio p').nth(1).textContent(),
    );
    await doHere('1');
    note(
      '1 first question',
      await card().locator('.chat-card-question').getAttribute('data-question'),
    );
    await shot('fetch-card-question', card());
    note(
      '1 asked',
      await fill(
        { url: 'https://health.fixture.test/reports/clinic-access-2025', run: '*' },
        'fetch',
      ),
    );
    note('1 summary', await summary());
    await card().locator('details.chat-sent summary').click();
    await shot('fetch-card-ready', card());
    await send('1');
    await shot('fetch-card-done', card());

    // 1b. A refused card: a site the workspace does not allow; the route's own reason shows.
    await p.selectOption('#chat-step', 'fetch_source');
    await p.click('button:has-text("Add a card")');
    await sleep(2500);
    await fill(
      { url: 'https://not-approved.example.org/page' },
      'refused fetch',
    );
    await send('1b refused');
    await shot('refused-card', card());

    // 2. Record a claim from the fetched passage.
    await say("What's next?");
    await doHere('2');
    const asked2 = await fill(
      {
        passage: '*',
        statement: 'Rural patients wait weeks for a first clinic appointment.',
        basis: '*',
        uncertainty: 'One synthetic report; not checked against other regions.',
        stance: 'Supports it',
        quote: '=',
        rationale: 'The report describes the waits directly.',
        type: '*',
      },
      'cite',
    ).catch(async (e) => {
      note('2 error', String(e));
      return null;
    });
    note('2 asked', asked2);
    note('2 summary', await summary());
    await shot('cite-card', card());
    await send('2');

    // 3. Budget: Standard needs no answers; the card shows what it will do.
    await say("What's next?");
    await doHere('3');
    note('3 asked', await fill({}, 'budget'));
    note('3 summary', await summary());
    await shot('budget-card', card());
    await send('3');

    // 4. Discovery from the conversation's theme ("start a discovery about …").
    await say('Start a discovery about rural clinic appointment waits');
    await doHere('4');
    note(
      '4 theme prefilled from the message',
      await card().locator('.chat-card-question input').inputValue(),
    );
    note(
      '4 asked',
      await fill(
        {
          theme: '=',
          target_users: 'Rural patients booking a first appointment',
          measurable_problem: 'Days from request to a first appointment',
          outcome_measure: 'Median days from request to appointment',
          field_a: 'Clinic scheduling',
          field_b: 'Airline overbooking',
          claims: ['*'],
          roles: ['*'],
          context: null,
        },
        'discover',
      ),
    );
    note('4 summary', await summary());
    await shot('discovery-card', card());
    await send('4', 6000);
    await shot('discovery-sent', card());

    // 5. The run asks at its gates: answer each waiting decision from a card.
    const pendingCount = async () =>
      (await api(`workspaces/${WS}/decisions?status=pending`)).length;
    const alternatives = async () =>
      (await api(`workspaces/${WS}/entities?kind=alternative&status=active`))
        .length;
    let answered = 0;
    for (let i = 0; i < 40; i++) {
      if ((await alternatives()) > 0 && (await pendingCount()) === 0) break;
      if ((await pendingCount()) === 0) {
        await sleep(3000);
        continue;
      }
      await say("What's waiting for me?");
      await doHere(`5.${answered}`);
      const asked = await fill(
        {
          decision: '*',
          choice: 'Approve once',
          rationale: 'The run may continue to the next stage.',
        },
        'approve',
      );
      if (answered === 0) {
        note('5 asked', asked);
        note('5 summary', await summary());
        await shot('approval-card', card());
      }
      await send(`5.${answered}`);
      answered++;
      await sleep(3000);
    }
    note('5 decisions answered from Chat', answered);
    note('5 options proposed', await alternatives());

    // 6. Score an option.
    await say("What's next?");
    await doHere('6');
    const scoreAnswers = (key, prompt) => {
      if (key === 'option') return 'Human-led';
      if (key.startsWith('r_')) return '4';
      if (key.startsWith('e_')) return ['*'];
      if (key.startsWith('w_'))
        return 'The recorded claim describes the waits this addresses.';
      if (key === 'influence') return '1';
      if (key === 'ethics' || key === 'access') return 'Clear';
      if (key.endsWith('_note'))
        return 'Looked at who is affected and what data it uses.';
      if (key.startsWith('c_')) return 'unknown';
      if (key === 'confidence') return '*';
      if (key === 'confidence_why') return 'One synthetic source.';
      return undefined;
    };
    const asked6 = await fill(scoreAnswers, 'score');
    note(
      '6 asked',
      asked6.map((a) => a.key),
    );
    note('6 summary', await summary());
    await shot('score-card', card());
    await send('6');

    // 7. Record the choice: recommend the human-led option, defer the rest.
    await say("What's next?");
    await doHere('7');
    const choiceAnswers = (key, prompt) => {
      if (key === 'problem') return '*';
      if (key.startsWith('d_'))
        return /Human-led/.test(prompt)
          ? 'Recommend (no new software)'
          : 'Defer';
      if (key.startsWith('why_')) return 'Weighed against the scored evidence.';
      if (key.startsWith('rev_'))
        return 'Waits do not fall within three months.';
      if (key === 'override')
        return 'Recommending an option that is not ranked first, on purpose.';
      if (key === 'rationale')
        return 'Start with the human-led option; revisit the others if it fails.';
      return undefined;
    };
    const asked7 = await fill(choiceAnswers, 'choose');
    note(
      '7 asked',
      asked7.map((a) => a.key),
    );
    note('7 summary', await summary());
    await shot('choice-card', card());
    let state7 = await send('7');
    // A run in the loop asks before a selection is recorded: approve, then send it again.
    for (let i = 0; i < 3 && /Done|Held for a decision/.test(state7); i++) {
      const held = await card().locator('.chat-card-result').innerText();
      if (!/Held for a decision/.test(held)) break;
      note('7 held', held.split('\n')[0]);
      await shot('choice-held', card());
      await say("What's waiting for me?");
      await doHere('7 approve');
      await fill(
        {
          decision: '*',
          choice: 'Approve once',
          rationale: 'Record the selection.',
        },
        'approve',
      );
      await send('7 approve');
      // Back to the held card: the same answers, sent again as a new card.
      await p
        .locator('.chat-card', { hasText: 'Held for a decision' })
        .last()
        .locator('button:has-text("Send again with the same answers")')
        .click();
      await sleep(3000);
      note(
        '7 again asked',
        (await fill(choiceAnswers, 'choose again')).map((a) => a.key),
      );
      state7 = await send('7 again');
    }

    // 8. Save a proposal for the chosen option.
    await p.selectOption('#chat-step', 'save_proposal');
    await p.click('button:has-text("Add a card")');
    await sleep(3000);
    const asked8 = await fill(
      (key) => (key === 'option' ? '*' : key === 'summary' ? '=' : null),
      'proposal',
    );
    note(
      '8 asked',
      asked8.map((a) => a.key),
    );
    note('8 summary', await summary());
    await shot('proposal-card', card());
    await send('8');
    note(
      '8 proposals',
      (await api(`workspaces/${WS}/proposals`)).map(
        (x) => x.title ?? x.proposal?.title ?? x.id,
      ),
    );

    // 9. A stale card: made from a claim that changes before it is sent.
    await p.selectOption('#chat-step', 'start_discovery');
    await p.click('button:has-text("Add a card")');
    await sleep(3000);
    await fill(
      {
        theme: 'clinic reminder calls',
        target_users: 'Rural patients',
        measurable_problem: 'Missed first appointments',
        outcome_measure: 'Share of missed first appointments',
        field_a: 'Clinic scheduling',
        field_b: 'Restaurant reservations',
        claims: ['*'],
        roles: ['*'],
        context: null,
      },
      'stale discover',
    );
    const claims = await api(
      `workspaces/${WS}/entities?kind=claim&status=active`,
    );
    const c0 = claims[0];
    const revised = await api(`workspaces/${WS}/entities/${c0.id}/revisions`, {
      expected_version: c0.version,
      title: `${c0.title} (corrected)`,
      body: c0.body,
      reason: 'Walk: change the claim after the card was made',
      corrects_version: null,
    });
    note('9 claim revised', {
      from: c0.version,
      to: revised.version,
      error: revised.error ?? null,
    });
    await send('9 stale');
    await shot('stale-card', card());

    // 10. The audit trail: who sent each card and what each send caused.
    const chats = await api(`workspaces/${WS}/chats`);
    const detail = await api(`workspaces/${WS}/chats/${chats[0].id}`);
    note(
      '10 cards',
      detail.actions.map((a) => ({
        kind: a.kind,
        origin: a.origin,
        state: a.state,
        events: a.outcome?.events ?? null,
        sent_by: a.sent_by,
      })),
    );
    await p.goto(`${B}/#/chat/conversations?ws=${WS}`);
    await sleep(2500);
    await shot('chat-overview');
  } catch (e) {
    await fail(e);
  }
  note('errors', errors);
  require('fs').writeFileSync(
    `${OUT}/walk.json`,
    JSON.stringify({ ws: WS, log, errors, formRequests }, null, 2),
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
