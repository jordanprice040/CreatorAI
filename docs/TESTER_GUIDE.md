# Creator Agent: tester guide

Thanks for trying Creator Agent. This page gets you from the installer file to a working studio in about
ten minutes. Everything runs on your own computer. Nothing leaves it unless you connect a model or start a step that says
it uses the internet.

## What you need

- Windows 10 or 11 (64-bit). No administrator rights are needed.
- Microsoft Edge WebView2, which Windows 11 and an up-to-date Windows 10 already have. If the Creator
  Agent window never opens, install Microsoft's free "Evergreen WebView2 Runtime" and start it again.
- About 1 GB of free disk space.
- These local ports free: 5173, 4310 and 4320 (they are only used on your own computer).

You do **not** need to install a database, Docker, Node or anything else: the tester installer includes them.

## 1. Check and install

1. You should have received `Creator-Agent_<version>_x64-setup.exe` and its SHA-256 hash.
2. Optional but recommended: check the file is the one that was sent. In PowerShell:
   `Get-FileHash .\Creator-Agent_<version>_x64-setup.exe` and compare the hash.
3. Run the installer. This test build is not code-signed yet, so Windows may show "Windows protected your
   PC". Choose **More info**, then **Run anyway**.
4. Keep the defaults and finish. Creator Agent installs for your user only.

## 2. First launch

Start **Creator Agent** from the Start menu. A small setup window opens.

1. **PostgreSQL 18 folder:** the list shows "✓ Included with Creator Agent", and the Folder box below it is
   already filled in with a path ending in `studio\postgres\bin`, with a note saying it is the included copy.
   Leave it as it is.
2. **Where the records come from:** keep **Start a new, empty studio**.
3. **When you close the window:** pick what you prefer (the default keeps the studio running in the tray).
4. Press **Set up Creator Agent** and confirm. It takes a minute or two.

When setup is done, press **Sign in as local owner**, then **Open the studio**.

## 3. Try it

- Create a workspace when the studio asks for one, then follow **Getting started** on the Chat page.
- **Standard** mode shows the everyday controls and keeps explanations short: press a one-line
  explanation or a folded section to open it. **Advanced** shows everything.
- Evidence lives under **Sources**: fetch a web page, or drop a text document (text, Markdown,
  CSV, JSON or code) anywhere on the page and press **Use as evidence** on Sources › Files. A
  claim's quote must appear word for word in that page or document. **Library** (also under
  Sources) lists every saved record with its versions and links.
- Model-driven steps (drafting, scoring with a model, building) need a model connection under
  **Models and connections → Models**: a ChatGPT plan, or Claude Code already signed in on this computer.
  Without one, those steps are refused with a message; the rest of the studio still works.
- Building and packaging products also needs WSL and Git for Windows. Skip it if you do not have them.

## 4. Sending feedback

Tell us what you tried, what you expected and what happened, with a screenshot if you can. If something
failed, the setup/status window's **Open logs folder** button opens the logs; please attach
`supervisor.log` and `service.log`. They are plain text, so you can read them before sending.

## Updating to a newer test build

Run the newer installer. When it says Creator Agent is already installed, keep the selected
**Do not uninstall** and continue. Your studio and its records stay. If the new version needs a newer
database layout, the status window asks first: press **Back up and upgrade the database**. (The in-app
**Updates** section is for the project's private release channel; testers can ignore it.)

## Uninstalling

Use Windows **Settings → Apps**. This removes the program only. Your studio (database, products, backups and
settings) stays in `%LOCALAPPDATA%\com.creatoragent.studio`. Delete that folder by hand if you want it all
gone; that cannot be undone.

## Known limits of this test build

- Not code-signed, so the Windows warning above appears. Unsigned test builds go only to people the project
  owner knows personally.
- Windows on x64 only.
- Nothing is sent to other people or services unless you connect a model or approve an action that says so.
