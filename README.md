# Subscription agents for DeepSeek Harness

A local, single-owner integration with the unmodified official Codex and Claude Code CLIs. It does not install the CLIs or collect or forward OAuth tokens. On this Mac, install and run as yourself and use only accounts you are authorized to use. For redistributable or hosted integrations, review the vendors' terms and supported API credentials separately.

## Read this before you use it

Subscription plans from OpenAI and Anthropic are meant for a person using the vendor's own apps. Driving the official CLIs from another program, and especially spreading work over several subscriptions to stay under their limits, may break those vendors' terms. Accounts can be rate-limited or suspended for it. This project does not hide or disguise anything from the vendors, and it will not help you get around a ban. Use it only with accounts you own, read the current terms yourself, and accept that the risk is yours. There is no warranty (see [LICENSE](LICENSE)).

## Requirements

- DeepSeek Harness Desktop 0.2.2-rc.3 or any later 0.2.x release. The manifest declares `engines.dsh: ">=0.2.2-rc.3 <0.3.0-0"`, so DSH updates inside 0.2 do not block the plugin. DSH 0.3 is refused until the plugin is checked against it.
- macOS, with the official `codex` and/or `claude` CLI already installed and on `PATH` (`~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` are searched).
- A DSH Session with **Full access** for agent work and subscription chats.

## Install

```bash
git clone https://github.com/adsqwui/dsh-subscription-agents.git
```

In DSH open **Plugin Manager**, install from the cloned folder and enable the bundle, then fully restart Desktop. The bundle replaces the shipped workspace sidebar, which only takes effect after a restart.

On start the plugin checks that every Host method it calls still exists. If a DSH update removed or renamed one, the plugin stops with an error naming the method and registers nothing, so no session is touched.

## Usage

Open **Subscription agents** in the left sidebar. Add a CLI profile, click Sign in and complete the provider's flow in your browser. If it did not open, use the pending sign-in link when displayed. After login the plugin attempts one minimal “OK” inference; **Test** repeats it. Enable dispatch separately. Disable stops new tasks and cancels a still-running delegated request if possible. Removing a profile also asks the CLI to log out locally. It does not revoke the provider's browser session.

After enabling a tested account, select its **Codex · подписка** or **Claude Code · подписка** entry in the chat's regular model picker or with `/model`. The account's CLI chooses the actual model. The conversation runs through that account only; the plugin neither reads API keys nor switches to another route when the CLI is unavailable or out of quota. A regular chat passes recent visible text to a fresh CLI turn, so switching between accounts or providers works without reusing their private thread state. Current attachments are unsupported. The same **Full access** requirement below applies to regular chats. See the [subscription model picker specification](spec/subscription-model-picker.md).

Codex accounts use a distinct CODEX_HOME with CLI-managed file authentication; Claude Code accounts use distinct CLAUDE_CONFIG_DIRs (CLI-managed macOS Keychain where available). Do not copy or share the private state directory. Existing unrelated CLI profiles are not imported. Accounts are named locally, independently of vendor identity; different rows are not proof of different subscriptions.

Actual quota: Codex App Server snapshots refresh roughly every three minutes and after a request. Claude Code stream events are opportunistic and may not report any windows; no paid background prompts are run to guess quota. After six minutes or after the window reset, snapshots do not influence routing. The tightest fresh window determines headroom; unknown is ranked after known positive headroom. Quota errors are not retried across accounts.

The `subscription_agent` tool starts a real continuable DSH child and returns its name immediately. The lead receives a completion notice; `send_message` resumes the same pinned account and vendor session. Open the native child chat to inspect the delegated prompt, completed assistant messages, recorded CLI tool calls/results and send follow-ups through DSH. CLI messages are streamed at message boundaries; hidden reasoning and nested vendor subagents are not fabricated. The bridge records external tool results but never executes those recorded tool calls again through DSH.

Full CLI work uses the parent project directory rather than the smoke test's private empty directory. In this version the DSH Session must have Full access; restricted Sessions fail closed because CLI permissions cannot reproduce DSH filesystem confinement. Codex still uses workspace-write with no interactive approvals; Claude Code uses acceptEdits and denies unanswered permission prompts, so arbitrary Bash commands are not automatically approved. Account disable prevents later turns and cancels the current account operation. Vendor thread IDs are stored privately per DSH child, alongside the account profiles. Removing an account prevents continuation of its existing children; their DSH transcript remains readable.

The bundle also carries a local workspace UI replacement in `workspace-ui/`. It preserves the installed workspace feature and adds collapsible native child rows directly under their parent chat. The bundle disables the shipped `ui-workspace` row while enabled; disabling this bundle restores the shipped UI. The patch refers to it by a path relative to `cordis.patch.yml`, so the folder can live anywhere.

`workspace-ui` is built from the MIT-licensed DSH `ui-workspace` package at `dsh-v0.2.2-rc.3` plus `workspace-ui/native-tree.patch` (DeepSeek's license is kept in `workspace-ui/LICENSE`). Upstream `ui-workspace` is unchanged between rc.3 and rc.5. Before relying on a newer DSH, check whether it changed, in a DSH source checkout:

```bash
git diff --stat dsh-v0.2.2-rc.3 <new-tag> -- packages/client/ui-workspace/src
```

Empty output means the bundled sidebar is still current. Otherwise re-apply `native-tree.patch` on the new source, rebuild with `tsdown.config.ts` (it expects the DSH checkout at `../../deepseek-harness-src` relative to `workspace-ui`) and run `node workspace-ui/finalize-build.mjs`.

Harness owns delegation for Codex subscription agents: each Codex process works directly, with nested Codex agents disabled for both new and resumed turns. To work in parallel, delegate independent tasks to separate Harness child chats. Empty legacy Codex waits are omitted from the transcript; reported agent states and errors remain visible. See [delegation specification](spec/agent-delegation.md).

## Tests

```bash
npm test
```

## License

MIT, see [LICENSE](LICENSE). `workspace-ui` contains code from DeepSeek Harness, also MIT, see `workspace-ui/LICENSE`.

References: [Codex CLI automation](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex App Server](https://developers.openai.com/codex/app-server), [Claude CLI auth](https://code.claude.com/docs/en/authentication), [Claude Code terms](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).
