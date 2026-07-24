**English** | [Español](PRIVACY.es.md)

# Privacy Policy

**Last updated:** 2026-07-24

This policy covers the **Actual Budget MCP Server** (`actual-budget-mcp-es`), an open-source MCP server distributed as source code and as a Claude Desktop extension (`.mcpb`).

## Who runs this software

There is no service behind it. The software runs **entirely on your own computer**, against **your own** self-hosted Actual Budget server. The author operates no servers, no accounts, and no infrastructure that this software talks to.

## What it collects

**Nothing.** This software has no telemetry, no analytics, no crash reporting, no usage metrics and no update checks. It never contacts the author or any third party of the author's choosing.

## What it accesses, and where that data goes

To do its job, the software reads your budget data — accounts, balances, transactions, categories, budgets and schedules — from your Actual Budget server. If you enable write tools, it can also modify that data.

That data travels to exactly two places, both of which you choose:

1. **Your Actual Budget server**, at the URL you configure. This is a direct connection from your computer to your server.
2. **The MCP client you connect it to** — in practice, Claude. When you ask a question, the answer includes the financial data needed to answer it, and that data is processed by your MCP client under **its own** privacy policy, not this one. If you use Claude, see [Anthropic's Privacy Policy](https://www.anthropic.com/legal/privacy).

This is the point of the software, not a side effect: it exists so an assistant can read your budget. Install it only if you are comfortable with your MCP client seeing the financial data you ask about.

## Credentials

Your Actual server URL, password and budget Sync ID are supplied by you as configuration.

- As a **Claude Desktop extension**, the password is stored by Claude Desktop's own secure storage; the other values are stored in Claude Desktop's configuration.
- As a **manual installation**, all of them live in environment variables or a local `.env` file that you control.

They are used only to authenticate against your own server. They are never transmitted anywhere else, and never written to logs.

## Local storage and retention

The Actual API downloads a **local, unencrypted copy** of your budget (a SQLite database) into the data directory, so that queries are fast and work offline. The directory is created with `0700` permissions, readable only by your user account.

This copy lives on your machine for as long as the software is installed. Nobody retains it but you: deleting the extension, or the data directory, removes it. Nothing is retained by the author, because nothing ever reaches the author.

## Third-party sharing

The author shares nothing, because the author receives nothing. The only parties that see your data are the two you chose: your own Actual server and your own MCP client.

## Children

This software is not directed at children and collects no data from anyone.

## Changes

Changes to this policy are published in this file, in the project's public repository, with the date above updated. The version history is visible in the repository's commit log.

## Contact

Open an issue at [github.com/marcoaperez/actual-budget-mcp-es/issues](https://github.com/marcoaperez/actual-budget-mcp-es/issues).
