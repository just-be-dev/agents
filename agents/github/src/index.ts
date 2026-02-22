import { routeAgentRequest } from "agents";
import { GitHubAgent } from "./github-agent.ts";

export { GitHubAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/webhooks/github")) {
      const stub = env.GITHUB_AGENT.get(env.GITHUB_AGENT.idFromName("github"));
      return stub.fetch(request);
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
