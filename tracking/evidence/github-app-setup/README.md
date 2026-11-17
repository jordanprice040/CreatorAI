# P32 GitHub App setup — studio walk (November 17, 2026)

ADR-0132. Checked in the real studio from branch `claude/project-thread-bqpf48` in the cloud
container: throwaway database `walk_p32` (migrated to 79), review ports 5183/4330/4340,
`CREATOR_GITHUB=live` with the development file vault, no model call, **no call to github.com**.
`walk.mjs` (run as its header says) creates a real workspace and opens Models and connections ›
GitHub. "Create the GitHub App" is only looked at, not pressed, because there is no GitHub to go
to here. The later steps are shown by writing setup rows straight into the throwaway database, as
GitHub would leave them; the steps themselves (code exchange, sealed key, installation read with
the app JWT, connect, Verify) are covered against a loopback stand-in for GitHub in
`tests/src/github-app-setup.test.ts`.

| Shot | What |
| ---- | ---- |
| `01-start.png` | A real workspace offers "Connect with GitHub (recommended)" and Create the GitHub App |
| `02-install.png` | After GitHub created the app: Install on GitHub (links to the app's installation page) and Check installation |
| `03-connect.png` | Installed: the connect form asks only the name, limits, checks and included repositories |
| `04-connected.png` | The connection row names the protected app key instead of an environment variable |
| `05-phone.png` | Phone width (390 px), no sideways scroll |

Result: [walk.txt](walk.txt), 6 of 6 PASS. Not covered here: the real GitHub pages (the live trial
needs Jordan's typed OK and a new private test repository).
