import { GitHubAgent } from "../agents/github/src/github-agent.ts";

export { GitHubAgent };

interface Env {
  GITHUB_AGENT: DurableObjectNamespace<GitHubAgent>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route GitHub webhooks to GitHub agent
    if (url.pathname.startsWith("/webhooks/github")) {
      return handleGitHubRoute(request, env);
    }

    // Status endpoint
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "agents-router",
        status: "running",
        agents: {
          github: {
            webhook: "/webhooks/github",
          },
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleGitHubRoute(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  // Webhook endpoint: extract repo name and route to agent instance
  if (request.method === "POST" && url.pathname === "/webhooks/github") {
    const clonedRequest = request.clone();
    let payload: Record<string, unknown>;

    try {
      payload = await clonedRequest.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const repo = payload.repository as { full_name: string } | undefined;

    if (!repo?.full_name) {
      return new Response("Missing repository info", { status: 400 });
    }

    // Use repo full name as agent instance name (e.g. "octocat-hello-world")
    const agentName = repo.full_name.replace("/", "-");
    const id = env.GITHUB_AGENT.idFromName(agentName);
    const stub = env.GITHUB_AGENT.get(id);

    return stub.fetch(request);
  }

  // For other paths under /webhooks/github/*, pass through to GitHub agent
  // This handles any additional GitHub-specific endpoints
  const defaultAgentId = env.GITHUB_AGENT.idFromName("default");
  const defaultStub = env.GITHUB_AGENT.get(defaultAgentId);
  return defaultStub.fetch(request);
}
