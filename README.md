# Cloudflare Agents Monorepo

A monorepo for building and deploying multiple AI agents as Cloudflare Workers with Durable Objects. Each agent is isolated in its own workspace but shares common packages and a unified deployment router.

## Structure

```
agents/
├── agents/          # Individual agent implementations
│   └── github/      # GitHub App agent (webhook handler, issue/PR automation)
├── packages/        # Shared code across agents (available for future use)
├── src/             # Unified router (routes webhooks to specific agents)
│   └── index.ts     # Entry point that routes to agent Durable Objects
├── wrangler.jsonc   # Cloudflare Workers deployment configuration
└── package.json     # Monorepo root with workspace configuration
```

## Architecture

The monorepo uses a **router pattern** where a single Worker (`src/index.ts`) routes incoming requests to the appropriate agent Durable Object:

```
POST /webhooks/github
  → Worker Router (src/index.ts)
    → Extract repo name from payload
    → Route to GitHubAgent Durable Object (agents/github/)
      → Agent instance per repository (isolated state)
      → SQLite storage, WebSocket state updates
      → GitHub API integration

GET /
  → Status endpoint listing all available agents
```

Each agent:
- Runs as a **Durable Object** with isolated state and SQLite storage
- Uses the [Agents SDK](https://www.npmjs.com/package/agents) for stateful WebSocket connections and RPC
- Gets its own instance per resource (e.g., one GitHub agent per repository)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime (managed via [mise](https://mise.jdx.dev))
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Wrangler CLI (installed via `bun install`)

### Installation

```bash
# Install Bun via mise (if not already installed)
mise install

# Install all dependencies (for all workspaces)
bun install

# Type check all packages
bun run typecheck
```

### Local Development

```bash
# Run the router worker locally with hot reload
bun run dev

# The dev server starts at http://localhost:8787
# Test the status endpoint: curl http://localhost:8787
```

### Deployment

```bash
# Deploy the unified router and all agents to Cloudflare
bun run deploy
```

The router worker will be deployed to your Cloudflare account with all configured Durable Object bindings.

## Available Agents

### GitHub Agent

A GitHub App agent that handles webhook events, stores them in SQLite, and can respond via the GitHub API.

- **Location**: `agents/github/`
- **Webhook Path**: `/webhooks/github`
- **Features**: Per-repo isolation, event storage, auto-commenting, WebSocket state
- **Documentation**: See [agents/github/README.md](./agents/github/README.md)

Example usage:
```bash
# GitHub webhooks are sent to:
POST https://your-worker.workers.dev/webhooks/github
```

## Adding a New Agent

Follow these steps to add a new agent to the monorepo:

### 1. Create Agent Directory

```bash
mkdir -p agents/my-agent/src
cd agents/my-agent
```

### 2. Create `package.json`

```json
{
  "name": "@just-be/my-agent",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "agents": "^0.5.1"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "wrangler": "^4.67.0"
  },
  "peerDependencies": {
    "typescript": "^5"
  }
}
```

### 3. Implement Agent Class

Create `agents/my-agent/src/my-agent.ts`:

```typescript
import { Agent } from "agents";

export class MyAgent extends Agent {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle webhooks or other requests
    if (request.method === "POST" && url.pathname === "/webhook") {
      // Process webhook
      return Response.json({ status: "received" });
    }

    return new Response("Not found", { status: 404 });
  }
}
```

### 4. Add Router Integration

Update `src/index.ts` to export your agent and add routing:

```typescript
import { MyAgent } from "../agents/my-agent/src/my-agent.ts";

export { GitHubAgent, MyAgent };

interface Env {
  GITHUB_AGENT: DurableObjectNamespace<GitHubAgent>;
  MY_AGENT: DurableObjectNamespace<MyAgent>;  // Add this
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Add your agent's route
    if (url.pathname.startsWith("/webhooks/my-agent")) {
      return handleMyAgentRoute(request, env);
    }

    // ... existing routes
  },
};

async function handleMyAgentRoute(request: Request, env: Env): Promise<Response> {
  // Get agent instance (use a name/ID scheme that makes sense)
  const id = env.MY_AGENT.idFromName("default");
  const stub = env.MY_AGENT.get(id);
  return stub.fetch(request);
}
```

### 5. Update Wrangler Configuration

Add your agent to `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "GITHUB_AGENT",
        "class_name": "GitHubAgent",
        "script_name": "agents-router"
      },
      {
        "name": "MY_AGENT",
        "class_name": "MyAgent",
        "script_name": "agents-router"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["GitHubAgent"]
    },
    {
      "tag": "v2",
      "new_sqlite_classes": ["MyAgent"]
    }
  ]
}
```

### 6. Test and Deploy

```bash
# Type check your new agent
bun run typecheck

# Test locally
bun run dev

# Deploy to Cloudflare
bun run deploy
```

Your new agent is now available at `/webhooks/my-agent` (or whatever path you configured).

## Development Commands

```bash
# Install dependencies for all workspaces
bun install

# Type check all packages
bun run typecheck

# Run development server (with hot reload)
bun run dev

# Deploy to Cloudflare Workers
bun run deploy

# Build GitHub agent CLI tool
bun run build:cli
```

## Architecture Patterns

### Per-Instance Isolation

Agents use Durable Objects to provide per-resource isolation. For example:
- GitHub agent: One instance per repository (`repo.full_name.replace("/", "-")`)
- Slack agent: One instance per workspace/channel
- Custom agent: One instance per user, organization, etc.

### State Management

Each agent instance has:
- **Durable Object storage**: Key-value store for small state
- **SQLite**: Relational database for structured data
- **WebSocket connections**: Real-time state updates to clients

### Webhook Routing

The router extracts identifying information from webhooks and routes to the correct agent instance:

```typescript
// Example: Route GitHub webhooks by repository
const agentName = repo.full_name.replace("/", "-");
const id = env.GITHUB_AGENT.idFromName(agentName);
const stub = env.GITHUB_AGENT.get(id);
return stub.fetch(request);
```

## License

MIT
