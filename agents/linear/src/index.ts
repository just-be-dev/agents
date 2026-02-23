import { routeAgentRequest } from "agents";
import { LinearAgent } from "./linear-agent.ts";

export { LinearAgent };

export async function routeLinearWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // Read body so we can route by organizationId for per-workspace isolation,
  // then forward as a new Request so the agent can read it again.
  const body = await request.text();
  let routingKey = "linear";

  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const organizationId = payload["organizationId"];
    if (typeof organizationId === "string" && organizationId) {
      routingKey = organizationId;
    }
  } catch {
    // Malformed JSON — pass through; the agent will return the appropriate error.
  }

  const stub = env.LINEAR_AGENT.get(env.LINEAR_AGENT.idFromName(routingKey));
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

    if (url.pathname.startsWith("/linear")) {
      return routeLinearWebhook(request, env);
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
