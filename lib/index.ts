import { routeAgentRequest } from "agents";
import { GitHubAgent } from "../agents/github/src/index.ts";
import { LinearAgent } from "../agents/linear/src/index.ts";

export { GitHubAgent, LinearAgent };

interface Env {
  GITHUB_AGENT: DurableObjectNamespace<GitHubAgent>;
  LINEAR_AGENT: DurableObjectNamespace<LinearAgent>;
}

type AgentModule = { default: { fetch(req: Request, env: Env): Promise<Response> } };

// Map each URL path prefix to its agent module. Adding a new agent means
// adding one entry here; no routing logic needs to change.
const agentRouters: Record<string, () => Promise<AgentModule>> = {
  github: () => import("../agents/github/src/index.ts"),
  linear: () => import("../agents/linear/src/index.ts"),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segment = url.pathname.split("/")[1];

    const loadRouter = agentRouters[segment];
    if (loadRouter) {
      const { default: handler } = await loadRouter();
      return handler.fetch(request, env);
    }

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
