import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChat, chatMentionsStudio } from '@creator/contracts';

// PR #139 fourth review: every phrasing named in the four chat-context review reports
// (PR #136 review, PR #139 re-review, third and fourth reviews), with the route it must take
// in Automatic. Later classifier edits must keep all of them; add new review cases here.
// A target is checked where the saved or searched text matters; null means no text is saved.
type Row = [text: string, intent: string, text?: string | null];
const ROUTES: Row[] = [
  // PR #136 review M1/M2
  ["What's blocked?", 'why_blocked'],
  ['Is anything blocked?', 'why_blocked'],
  ['What is blocked right now?', 'why_blocked'],
  ['Why is it blocked?', 'why_blocked'],
  ['What needs approval?', 'approvals'],
  ['Anything waiting?', 'approvals'],
  ["What's waiting?", 'approvals'],
  ["What's pending?", 'approvals'],
  ['Any approvals?', 'approvals'],
  ['How do I approve a build?', 'note'],
  ["What's an approval?", 'note'],
  ["Why won't my idea work?", 'why_blocked'],
  ['Does https://example.org/study support this?', 'add_source'],
  [
    'Save this as a better name: Rise Street',
    'save_idea',
    'as a better name: Rise Street',
  ],
  // PR #136 review L3
  ['Research how vaccines work', 'note'],
  ['Explore the themes of Hamlet', 'note'],
  ['Remember to be concise', 'note'],
  ["I'm stuck on my essay intro", 'note'],
  ['My drain is blocked', 'note'],
  // PR #139 re-review L-C/N-C
  ['Is there anything blocked?', 'why_blocked'],
  ['Are any runs blocked?', 'why_blocked'],
  ['Anything pending?', 'approvals'],
  ['Do I need to approve anything?', 'approvals'],
  ['Everything is blocked', 'why_blocked'],
  ['Remember that I prefer short answers', 'note'],
  ['Remember I like bullet points', 'note'],
  ['Note that the deadline is Friday', 'note'],
  ['Save me a seat', 'note'],
  ['Research vaccines', 'start_discovery', 'vaccines'],
  // third review L-1
  ['How do I fix a stuck build in Jenkins?', 'note'],
  ['Write an email to my team saying the build is blocked', 'note'],
  ['Explain why npm install gets stuck on every run', 'note'],
  ['What causes a Docker build to get stuck?', 'note'],
  ['Help me write a spec for a stuck elevator alarm', 'note'],
  ['My CI build is stuck, any tips?', 'why_blocked'],
  // third review L-2
  ['Remember that idea about timers', 'save_idea', 'timers'],
  ['Note that idea: a timer', 'save_idea', 'a timer'],
  ['Remember my thought: a timer app', 'save_idea', 'a timer app'],
  ['Note my note: buy milk', 'save_idea', 'buy milk'],
  ['remember that', 'note'],
  ['Save that idea: a timer', 'save_idea', 'a timer'],
  ['Remember this idea: a timer', 'save_idea', 'a timer'],
  // fourth review L-B
  ['Note that ideas are cheap', 'note'],
  ['Remember that ideas need testing', 'note'],
  ['Remember that thoughts become things', 'note'],
  ['Note that thoughts are free', 'note'],
  ['Note that notes go in the drawer', 'note'],
  ['Remember my notes are in the drawer', 'note'],
  ['Note my thoughts on the meeting were positive', 'note'],
  // fourth review L-C
  ['Which runs are blocked?', 'why_blocked'],
  ['What runs are stuck?', 'why_blocked'],
  ['Which builds are stuck?', 'why_blocked'],
  ["Is there a run that's stuck?", 'why_blocked'],
  ['How come the build is stuck?', 'why_blocked'],
  ["Show me what's blocked", 'why_blocked'],
  ['What is blocked in this project?', 'why_blocked'],
  // fourth review L-C/nits
  ['Which builds get stuck in Jenkins and why?', 'note'],
  ['Note to self: buy milk', 'save_idea', 'buy milk'],
  ['Remember that idea?', 'save_idea', null],
  ['Remember that thought experiment about trolleys?', 'note'],
  // earlier tests and fourth review checks
  ['Why is my build stuck?', 'why_blocked'],
  ['Can you tell me why my run is blocked?', 'why_blocked'],
  ['Is the build blocked by the budget?', 'note'],
  ['Write an email asking my boss to approve my vacation', 'note'],
  ['How do I approve a pull request on GitHub?', 'note'],
  ['What needs my approval?', 'approvals'],
  ['Why is my run stuck?', 'why_blocked'],
  ["I can't start the build", 'why_blocked'],
  ['Why is the build blocked?', 'why_blocked'],
  ['Are there pending approvals?', 'approvals'],
  ['approve', 'approvals'],
  ['Next step?', 'next'],
  ["What's next?", 'next'],
  ['What is my next step?', 'next'],
  ['so what do I do next', 'next'],
  ['research input timing drills', 'start_discovery', 'input timing drills'],
  ['remember', 'save_idea'],
  ['remember this idea: a timer', 'save_idea', 'a timer'],
  ['Is my build stuck?', 'why_blocked'],
  ['Are there any runs stuck?', 'why_blocked'],
  ['Brainstorm three names for a neighbourhood bakery.', 'note'],
  // fifth review L-1: "about"/"to self" stay part of an idea after a colon, dash or in a word
  ['Save my idea: About Time', 'save_idea', 'About Time'],
  [
    'Save this idea: about.me for plumbers',
    'save_idea',
    'about.me for plumbers',
  ],
  [
    'Remember that idea: to self-publish books',
    'save_idea',
    'to self-publish books',
  ],
  ['Save this idea - about face drills', 'save_idea', 'about face drills'],
  ['Note to self: buy milk', 'save_idea', 'buy milk'],
  ['Note: buy milk', 'save_idea', 'buy milk'],
  [
    'Save this idea: a caf\u00e9 called \u2018Rise\u2019',
    'save_idea',
    'a caf\u00e9 called \u2018Rise\u2019',
  ],
  // fifth review L-2: curly apostrophes and joined 's
  ['What\u2019s blocked?', 'why_blocked'],
  ['Show me what\u2019s blocked', 'why_blocked'],
  ['Is there a run that\u2019s stuck?', 'why_blocked'],
  ["Everything's stuck", 'why_blocked'],
  ["Everything's blocked", 'why_blocked'],
  ["It's stuck", 'why_blocked'],
  ["Something's blocked", 'why_blocked'],
  ["Why's it blocked?", 'why_blocked'],
  ['What\u2019s next?', 'next'],
  ['What\u2019s waiting?', 'approvals'],
  ['I can\u2019t start the build', 'why_blocked'],
  ["It's stuck in my throat", 'note'],
  ["That's stuck with me for years", 'note'],
  // fifth review L-3: one polite wrapper around a short studio question
  ["Can you show me what's blocked?", 'why_blocked'],
  ["Please show me what's blocked", 'why_blocked'],
  ["Show me what's blocked please", 'why_blocked'],
  ['So which runs are blocked?', 'why_blocked'],
  ["What's blocked and why?", 'why_blocked'],
  ['Are workers stuck?', 'why_blocked'],
  ["Please, what's next?", 'next'],
  // fifth review checked-and-fine: general questions that stay notes
  ['Which websites are blocked in China?', 'note'],
  ['Which roads are blocked by snow?', 'note'],
  ['Which runs are blocked by the referee in cricket?', 'note'],
  ['How come the run is blocked by the defender?', 'note'],
  ['Tell me everything stuck in my head', 'note'],
  ['What is stuck in my throat?', 'note'],
  ["Is there a run that's stuck in my stocking?", 'note'],
  ['Which grants are blocked?', 'note'],
  // fifth review nits N-1, N-2, N-4
  ['Save a thought experiment about trolleys', 'note'],
  ['Remember the thought experiment about trolleys', 'note'],
  ['Remember: I prefer short answers', 'note'],
  ['Remember, I prefer short answers', 'note'],
  ['Remember you said timers are good', 'note'],
  ['Remember we agreed on timers', 'note'],
  ['Save this idea: \u2026', 'save_idea', null],
  // PR #139 re-review N-C, left as discovery on purpose
  ['Explore remote work tools', 'start_discovery', 'remote work tools'],
  ['Discover new music', 'start_discovery', 'new music'],
];

// PR #136 review L2 and PR #139 re-review L-D: ordinary uses of studio words are not mentions.
const MENTIONS: [string, boolean][] = [
  ['Tell me about the projects of Frank Lloyd Wright', false],
  ["What's the best way to structure the workspace in my garage?", false],
  ['Make a list of pros and cons of the studio apartment', false],
  ['Suggest a name for this project', false],
  ['How should I decorate my studio apartment?', false],
  ["What's the best desk for my workspace setup?", false],
  ['Which of my ideas is the easiest first build?', true],
  ["What's in my studio?", true],
  ['our runs', true],
  // third and fifth reviews: checked-and-fine mentions
  ['my projects space', false],
  ["my studio's apartment", true],
  ['Compare my ideas', true],
  ['Design my workspace desk', false],
];

test('chat classifier keeps every reviewed phrasing on its route', () => {
  for (const [text, intent, target] of ROUTES) {
    const got = classifyChat(text);
    assert.equal(got.intent, intent, text);
    if (target === null) assert.deepEqual(got.target, {}, text);
    else if (target !== undefined) assert.equal(got.target.text, target, text);
  }
});

test('an explicit context sends every reviewed phrasing to the model', () => {
  for (const scope of ['general', 'project', 'selected'] as const)
    for (const [text] of ROUTES)
      assert.deepEqual(
        classifyChat(text, scope),
        { intent: 'note', target: {} },
        `${scope}: ${text}`,
      );
});

test('studio mentions in Automatic match only the studio itself', () => {
  for (const [text, mentions] of MENTIONS)
    assert.equal(chatMentionsStudio(text), mentions, text);
});
