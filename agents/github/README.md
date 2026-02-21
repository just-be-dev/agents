# GitHub App Agent

A GitHub App that runs as a Cloudflare Agent (Durable Object) using the [`agents`](https://www.npmjs.com/package/agents) SDK. It receives GitHub webhook events, verifies signatures, stores events in SQLite, and can respond via the GitHub API.

## Features

- **Webhook handling** — Receives and verifies GitHub webhook events using Web Crypto (HMAC-SHA256)
- **Per-repo isolation** — Each repository gets its own Durable Object instance with isolated state and storage
- **Event storage** — Events stored in SQLite with deduplication by delivery ID
- **GitHub API integration** — Authenticates as a GitHub App installation to comment, label, and react
- **Real-time state** — WebSocket clients get live state updates when events arrive
- **RPC methods** — Query events and trigger GitHub actions via `@callable()` methods

## Prerequisites

- [Bun](https://bun.sh) (managed via [mise](https://mise.jdx.dev))
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A GitHub App (see setup below)

## Setup

### 1. Install dependencies

```bash
mise install   # installs Bun
bun install    # installs packages
```

### 2. Create a GitHub App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
2. Set the **Webhook URL** to your Worker URL + `/webhooks/github` (e.g., `https://github-app-agent.your-account.workers.dev/webhooks/github`)
3. Set a **Webhook secret** — save this for later
4. Under **Permissions**, grant at minimum:
   - **Issues**: Read & Write (to comment on issues)
   - **Pull requests**: Read & Write (to comment on PRs)
   - **Metadata**: Read-only (required)
5. Subscribe to events: **Issues**, **Pull request**, **Push** (or whichever you need)
6. Create the app, then:
   - Note the **App ID** from the app settings page
   - Generate and download a **Private Key** (`.pem` file)

### 3. Configure secrets

For **local development**, edit `.dev.vars`:

```
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

For **production**, use wrangler secrets:

```bash
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_PRIVATE_KEY
```

### 4. Run locally

```bash
mise run dev
# or
bun run dev
```

The dev server starts at `http://localhost:8787`.

### 5. Deploy

```bash
mise run deploy
# or
bun run deploy
```

## Architecture

```
POST /webhooks/github
  → Worker (src/index.ts)
    → Extract repo name from payload
    → getAgentByName(env.GITHUB_AGENT, repoName)
      → GitHubAgent Durable Object (src/github-agent.ts)
        → Verify webhook signature (HMAC-SHA256)
        → Store event in SQLite
        → Update state (broadcasts to WebSocket clients)
        → Handle event (e.g. issues.opened → auto-comment)

WebSocket /agents/github-agent/:name
  → routeAgentRequest(req, env)
    → GitHubAgent Durable Object
      → @callable() getEvents(), getEventsByType()
      → @callable() commentOnIssue(), addLabel(), createReaction()
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Status/info JSON |
| POST | `/webhooks/github` | GitHub webhook receiver |
| WS | `/agents/github-agent/:name` | WebSocket connection to an agent instance |

## RPC Methods

Connect via WebSocket to call these methods:

- `getEvents(limit?)` — Get recent events (default 20)
- `getEventsByType(type, limit?)` — Get events filtered by type
- `commentOnIssue(owner, repo, issueNumber, body, installationId)` — Post a comment
- `addLabel(owner, repo, issueNumber, labels, installationId)` — Add labels
- `createReaction(owner, repo, issueNumber, reaction, installationId)` — Add a reaction

## Extending

The example `issues.opened` handler in `src/github-agent.ts` demonstrates the full webhook → GitHub API round-trip. Add your own handlers in the `handleEvent` method:

```typescript
private async handleEvent(eventType: string, action: string, payload: Record<string, unknown>) {
  if (eventType === "pull_request" && action === "opened") {
    // Your custom logic here
  }
}
```

## Development

```bash
mise run typecheck  # Type check
mise run types      # Regenerate wrangler types
mise run dev        # Local dev server
mise run deploy     # Deploy to Cloudflare
```
