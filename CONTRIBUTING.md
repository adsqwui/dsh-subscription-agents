# Contributing

Thanks for wanting to help. Bug reports, small fixes, docs and bigger features are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Check the [delegation spec](spec/agent-delegation.md) and the [model picker spec](spec/subscription-model-picker.md). They describe behaviour the plugin promises, and a change that breaks them needs a good reason.

## Setup

```bash
git clone https://github.com/adsqwui/dsh-subscription-agents.git
cd dsh-subscription-agents
npm test
```

There is nothing to install: the code uses only Node built-ins plus the DSH Host at runtime, and the tests replace the CLIs and the Host with fakes. Node 22 or newer is required.

To try a change in DSH, install the folder through **Plugins → Add plugin** with its absolute path. DSH links to the folder, so after an edit you only need to restart Desktop.

## Rules that keep accounts safe

These are not negotiable, because breaking them puts real users' accounts at risk:

- Never read, copy, forward or log OAuth tokens, API keys or anything inside a CLI's profile folder. The CLIs own their credentials.
- Never retry a quota or auth failure on another account automatically.
- Never give a CLI more than the DSH session has: restricted sessions stay refused, and only a Full access session runs the CLI without permission checks.
- Never execute recorded CLI tool calls again through DSH.
- Never fake output the CLI did not produce.

## Pull requests

- One topic per PR, with a short description of the problem and the fix.
- Add or update a test for behaviour changes. `npm test` must pass; CI runs it on Node 22 and 24 on Linux and macOS.
- Keep the existing style: plain ES modules, no build step for the host code, no new runtime dependencies without discussing them first.
- If you touch `workspace-ui/`, edit `native-tree.patch` and rebuild as described in the README rather than editing the bundled `client.js` by hand.
- Update the README when user-visible behaviour changes.

## Reporting a bug

Use the bug report form. Include your DSH version, the CLI and its version (`codex --version` or `claude --version`), what you did, what you expected and what happened. Remove account names, emails and tokens from logs before posting.

## Security issues

Please do not open a public issue for something that could expose accounts or credentials. Use [GitHub's private vulnerability reporting](https://github.com/adsqwui/dsh-subscription-agents/security/advisories/new) instead.
