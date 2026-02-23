import { routeAgentRequest } from "agents";
import { GitHubAgent } from "./github-agent.ts";

export { GitHubAgent };

export async function routeGitHubWebhook(
  request: Request,
  env: { GITHUB_AGENT: DurableObjectNamespace<GitHubAgent> }
): Promise<Response> {
  // Read body so we can route by installation + repo for per-instance isolation,
  // then forward as a new Request so the agent can read it again.
  const body = await request.text();
  let routingKey = "github";

  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const installationId = (payload.installation as { id?: number } | undefined)?.id;
    const repoName = (payload.repository as { full_name?: string } | undefined)?.full_name;
    if (installationId != null && repoName) {
      routingKey = `${installationId}/${repoName}`;
    } else if (installationId != null) {
      routingKey = String(installationId);
    }
  } catch {
    // Malformed JSON — pass through; the agent will return the appropriate error.
  }

  const stub = env.GITHUB_AGENT.get(env.GITHUB_AGENT.idFromName(routingKey));
  return stub.fetch(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    })
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/github")) {
      return routeGitHubWebhook(request, env);
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
