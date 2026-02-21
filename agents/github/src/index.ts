import { routeAgentRequest, getAgentByName } from "agents";
import { GitHubAgent } from "./github-agent.ts";

export { GitHubAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Webhook endpoint: route to per-repo agent instances
    if (request.method === "POST" && url.pathname === "/webhooks/github") {
      const clonedRequest = request.clone();
      let payload: Record<string, unknown>;

      try {
        payload = await clonedRequest.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const repo = payload.repository as
        | { full_name: string }
        | undefined;

      if (!repo?.full_name) {
        return new Response("Missing repository info", { status: 400 });
      }

      // Use repo full name as agent instance name (e.g. "octocat/hello-world")
      const agentName = repo.full_name.replace("/", "-");
      const agent = await getAgentByName(
        env.GITHUB_AGENT as unknown as DurableObjectNamespace<GitHubAgent>,
        agentName
      );

      return agent.fetch(request);
    }

    // Status endpoint
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "github-app-agent",
        status: "running",
        endpoints: {
          webhook: "/webhooks/github",
          agents: "/agents/github-agent/:name",
        },
      });
    }

    // Default: route WebSocket/RPC connections to agents
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("Not found", { status: 404 });
  },
};
