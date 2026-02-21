# Cloudflare Agents Monorepo

Monorepo for Cloudflare Worker agents and shared packages.

## Structure

- `agents/` - Agent implementations
  - `github/` - GitHub App agent
- `packages/` - Shared packages and libraries

## Getting Started

```bash
# Install dependencies
bun install

# Run typecheck across all packages
bun run typecheck
```

## Agents

### GitHub Agent

See [agents/github/README.md](./agents/github/README.md) for details.
