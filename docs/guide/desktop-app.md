# Desktop app (Windows and macOS)

TicketForge also comes as a desktop app. It is the same app as `npm start`, packaged with
[Electron](https://www.electronjs.org): no Node.js, Git checkout or terminal needed to run it.

## Install it

| Computer | File | First launch |
| --- | --- | --- |
| Windows 10 or 11 (64-bit) | `TicketForge-<version>-win-x64-setup.exe` | Run it. If SmartScreen says "Windows protected your PC", click **More info → Run anyway** (the installer isn't code-signed yet). |
| Mac with Apple Silicon (M1 or newer) | `TicketForge-<version>-mac-arm64.dmg` | Open the .dmg and drag TicketForge to Applications. The first time, right-click the app → **Open** → **Open**, or use **System Settings → Privacy & Security → Open Anyway**. |
| Mac with Intel | `TicketForge-<version>-mac-x64.dmg` | As above. |

On first launch TicketForge shows **Set up TicketForge**: create the owner account, as in the web version.

## How it works

- The app starts the TicketForge server on `127.0.0.1` (port 51730, or the next free one) and shows it in its
  window. Nobody else on the network can reach it.
- Requests come from this computer, so the **Claude account**, local folders, git and test runs work as they do on
  `localhost`. On a Mac the app reads `PATH` from your login shell, so `claude`, `git` and `gh` installed with
  Homebrew or npm are found.
- Links to other sites open in your default browser.

## Choose the database

On first launch the app asks which database to use:

- **Your team's PostgreSQL database** (recommended for a team). Everyone who uses TicketForge together connects to the
  same one and sees the same projects. Paste its connection string, click **Test connection**, then **Connect**. The
  string is saved on this computer only, in `ticketforge.env` (readable by your user account only), never in the
  installer.
- **A database on this computer only**, for trying TicketForge alone.

To switch later, choose **TicketForge → Change database…** (on Windows, **File → Change database…**). The server
restarts with the new database.

### Railway

1. In [Railway](https://railway.com), add a **PostgreSQL** service to a project (or open the one you have).
2. Open the service → **Variables** and copy **`DATABASE_PUBLIC_URL`** (host like `xxxx.proxy.rlwy.net`). The plain
   `DATABASE_URL` uses Railway's private network (`postgres.railway.internal`) and doesn't work from a desktop app;
   the setup screen tells you if you paste it.
3. Paste it into the setup screen. The first time, TicketForge creates its tables and row-level security.

Railway counts traffic over the public address as network egress on your bill. TicketForge sends small queries, so it
is usually low.

> [!IMPORTANT]
> The connection string holds the database password. Anyone who has it can read and change all TicketForge data,
> whatever their role in the app. Give it only to people who should use TicketForge, through a password manager rather
> than chat or email. To take someone's access away, change the password in Railway and give the new string to everyone
> else.

All computers that use the same connection string can read the API keys saved in **Administration → AI**: they are
encrypted with a key derived from the database login. If you change the database password, set
`TICKETFORGE_KEY_FROM_URL` to the old string in `ticketforge.env` (see [Configuration](configuration.md)), or enter
the keys again.

### Move what you made on this computer

If you started with **A database on this computer only** and want to keep that data, copy it once from a checkout of
the repository, with the app closed:

```bash
DATABASE_URL='postgresql://…' TICKETFORGE_DATA="$HOME/Library/Application Support/TicketForge/data" npm run db:push
```

On Windows, set `TICKETFORGE_DATA` to `%APPDATA%\TicketForge\data`. Rows already in PostgreSQL are left alone. Then
choose **Change database…** and connect to it.

## Use your Claude subscription

In the desktop app TicketForge uses **your own Claude account** (Pro or Max) through
[Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup), with no API key. The app has a built-in
terminal to set it up:

1. Open **Terminal → Show or hide terminal** (or press `` Ctrl+` ``). On first launch it opens by itself when Claude
   Code isn't ready yet.
2. The bar at the top of the terminal shows where you are:

   | It says | Click | What happens |
   | --- | --- | --- |
   | Claude Code isn't installed | **Install Claude Code** | Runs Anthropic's installer in the terminal (`curl -fsSL https://claude.ai/install.sh \| bash` on macOS, `irm https://claude.ai/install.ps1 \| iex` in PowerShell on Windows) |
   | Claude Code … is too old | **Update Claude Code** | The same installer. TicketForge needs 2.1 or newer |
   | Claude Code: not signed in | **Sign in to Claude** | Runs `claude auth login`. Your browser opens: sign in and approve. If the terminal asks for a code, paste it |
   | Claude Pro account: you@example.com | | Ready. TicketForge uses this account |

3. When the account becomes ready, the app restarts its server once so TicketForge picks it up, and the pill at the top
   right of TicketForge shows **Claude account**.

If you sign in some other way (for example by typing `claude` and `/login` in the terminal), close the terminal or
click **Check again**.

The terminal is an ordinary shell: zsh or bash on macOS (your login shell, with your `PATH`), PowerShell on Windows. It
starts in your home folder. **Terminal → New shell** starts a fresh one. Right-click copies the selection, or pastes
when nothing is selected.

> [!NOTE]
> If you have more than one Claude Code installed, TicketForge uses the newest. Typing `claude` in a terminal runs
> whichever comes first on your `PATH`, which may be an older copy. An old `npm install -g @anthropic-ai/claude-code`
> in `/usr/local/bin` is a common cause: remove it with `npm uninstall -g @anthropic-ai/claude-code`.

On Windows, Claude Code also needs [Git for Windows](https://git-scm.com/downloads/win). The bar links to it when Git
isn't found. After installing Git, click **Check again**.

## Where your data lives

| | macOS | Windows |
| --- | --- | --- |
| Data (built-in database, secret key, folders) | `~/Library/Application Support/TicketForge/data` | `%APPDATA%\TicketForge\data` |
| Settings | `~/Library/Application Support/TicketForge/ticketforge.env` | `%APPDATA%\TicketForge\ticketforge.env` |
| Server log | `~/Library/Application Support/TicketForge/logs/server.log` | `%APPDATA%\TicketForge\logs\server.log` |

The **TicketForge** menu (on Windows, **File**) has **Open settings file**, **Open data folder**, **Show server
log**, **Open in browser** and **Restart server**.

Uninstalling the app keeps your data. Delete the folder above to remove it too.

## Settings

`ticketforge.env` takes the same settings as `.env` in the web version (see [Configuration](configuration.md)), for
example `DATABASE_URL` to use PostgreSQL or Supabase instead of the built-in database, the `SMTP_*` settings for
email, or `AI_PROVIDER` / `AI_API_KEY`. Save the file, then choose **Restart server**.

`APP_URL` and `PORT` are set by the app. `TICKETFORGE_DESKTOP_PORT` (set in your environment, not the file) changes
the port it tries first.

## Build the installers

Each installer has to be built on its own platform, because some packages ship native code for the computer they
are installed on.

**With GitHub Actions (both platforms):** open **Actions → Desktop build → Run workflow**. When it finishes, download
the installers from the run's **Artifacts**. Pushing a tag such as `v1.0.2` also attaches them to a GitHub release.

**On a Mac:**

```bash
npm ci
```

```bash
npm run desktop:dist:mac
```

**On Windows:**

```bash
npm ci
```

```bash
npm run desktop:dist:win
```

The installers are written to `dist-desktop/`. To try the app without packaging it, run `npm run desktop:dev`.

### Code signing (optional)

Unsigned apps work but show the warnings described in [Install it](#install-it). To sign them, add these repository
secrets for the workflow (or set them as environment variables when building locally):

| Secret | What |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | An Apple **Developer ID Application** certificate (.p12, base64) and its password |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | A Windows code-signing certificate (.pfx, base64) and its password |

To stop macOS asking at all, the app also has to be notarized with an Apple Developer account. See
[electron-builder: code signing](https://www.electron.build/code-signing).

## Files

| File | What |
| --- | --- |
| `desktop/main.cjs` | Electron main process: the window (app above, terminal below) and the Claude setup flow |
| `desktop/server.cjs` | Starts and stops the TicketForge server |
| `desktop/database.cjs`, `desktop/setup.cjs`, `desktop/setup/` | The database setup screen: checks a connection string and saves it |
| `desktop/claude.cjs` | Finds Claude Code and checks the sign-in (`claude auth status --json`) |
| `desktop/terminal.cjs`, `desktop/terminal/` | The built-in terminal: a shell in a pseudo-terminal ([node-pty](https://github.com/microsoft/node-pty)) shown with [xterm.js](https://xtermjs.org) |
| `desktop/env.cjs`, `desktop/paths.cjs`, `desktop/menu.cjs` | Settings file, `PATH`, folders and the menu |
| `desktop/build/` | App icon, macOS entitlements, and the packaging hooks (helper permissions, ad-hoc signing) |
| `electron-builder.yml` | What goes into the installers |
| `.github/workflows/desktop-build.yml` | Builds the installers on GitHub Actions |
