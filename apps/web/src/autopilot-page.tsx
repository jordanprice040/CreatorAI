import type { SessionInfo, Workspace } from '@creator/contracts';
import { Autopilot } from './autopilot.js';
import { Automation } from './automation.js';
import { AutopilotSettingsPanel } from './autopilot-settings.js';
import { reveal } from './ui.js';
import type { View } from './pages.js';

// ADR-0111 (Jordan's request, November 15): the whole autopilot flow on one page instead of
// spread over Discover, Decide and Monitor. In order: the autopilots working or waiting for
// you (progress, Stop, Continue and what to do about a stop), starting a new one, how much is
// automated, the autopilot settings, and earlier autopilots. A person's own step (a choice
// under Decide, an approval, claims to read) still happens where that work is, and each card
// links there; Continue is always here.

const JUMPS = [
  ['autopilot-now-title', 'Working or waiting'],
  ['autopilot-title', 'Start'],
  ['automation-title', 'How much is automated'],
  ['autopilot-settings-title', 'Settings'],
] as const;

export function AutopilotPage({
  session,
  workspace,
  open,
  focus = '',
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
  /** An autopilot id from the address: the page opens on its card. */
  focus?: string;
}) {
  return (
    <section
      className="panel autopilot-page"
      aria-labelledby="autopilot-page-title"
    >
      <h2 id="autopilot-page-title">Autopilot</h2>
      <p>
        The autopilot takes the steps from the evidence to a proposal for you
        and stops where a person must decide. Everything about it is here: what
        it is doing, why it stopped and what to do next, Continue, and starting
        a new one with its settings.
      </p>
      <nav className="jump-links small" aria-label="On this page">
        {JUMPS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="text small"
            onClick={(e) => reveal(e.currentTarget, id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <Autopilot
        key={`autopilot-${workspace.id}`}
        session={session}
        workspace={workspace}
        open={open}
        focus={focus}
        between={
          <>
            <Automation
              key={`automation-${workspace.id}`}
              session={session}
              workspace={workspace}
            />
            <section
              className="explore"
              aria-labelledby="autopilot-settings-title"
            >
              <h3 id="autopilot-settings-title">Autopilot settings</h3>
              {workspace.role === 'owner' ? (
                <AutopilotSettingsPanel
                  key={`settings-${workspace.id}`}
                  session={session}
                  workspace={workspace}
                />
              ) : (
                <p className="small">
                  Only the workspace owner can change the autopilot settings.
                </p>
              )}
            </section>
          </>
        }
      />
    </section>
  );
}
