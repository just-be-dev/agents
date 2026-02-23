import { Agent, callable } from "agents";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { count, desc } from "drizzle-orm";
import { sessions } from "./schema.ts";
import migrations from "./migrations.ts";
import type { AgentState, AgentSession, LinearWebhookPayload, StoredSession } from "./types.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

const AGENT_ACTIVITY_CREATE = `
  mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity { id type }
    }
  }
`;

export class LinearAgent extends Agent<Env, AgentState> {
  db!: DrizzleSqliteDODatabase;

  override initialState: AgentState = {
    sessionCount: 0,
    lastSession: null,
  };

  override async onStart() {
    this.db = drizzle(this.ctx.storage);
    await migrate(this.db, migrations);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = request.headers.get("linear-signature");
    const body = await request.text();

    if (!signature || !(await this.verifySignature(body, signature))) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: LinearWebhookPayload;
    try {
      payload = JSON.parse(body) as LinearWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.type !== "AgentSessionEvent") {
      return new Response("OK", { status: 200 });
    }

    const { action, organizationId, agentSession } = payload;

    if (!agentSession?.id) {
      return new Response("Missing agentSession", { status: 400 });
    }

    this.db
      .insert(sessions)
      .values({
        id: agentSession.id,
        workspace_id: organizationId,
        issue_id: agentSession.issue?.id ?? "",
        issue_identifier: agentSession.issue?.identifier ?? "",
        action,
        prompt_context: agentSession.promptContext ?? "",
        payload: body,
        timestamp: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();

    const countResult = this.db.select({ count: count() }).from(sessions).all();
    this.setState({
      sessionCount: countResult[0]?.count ?? 0,
      lastSession: {
        id: agentSession.id,
        action,
        timestamp: new Date().toISOString(),
      },
    });

    // Respond within 5 seconds; process asynchronously
    this.ctx.waitUntil(this.handleSession(action, agentSession));

    return new Response("OK", { status: 200 });
  }

  @callable()
  getSessions(limit = 20, offset = 0): StoredSession[] {
    return this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.timestamp))
      .limit(limit)
      .offset(offset)
      .all() as StoredSession[];
  }

  // --- Internal methods ---

  private async handleSession(action: string, session: AgentSession): Promise<void> {
    try {
      if (action === "created") {
        await this.emitThought(session.id, `Reviewing issue ${session.issue?.identifier ?? ""}...`);
        await this.emitResponse(session.id, `I've reviewed issue ${session.issue?.identifier ?? ""}. Let me know if you need anything specific.`);
      } else if (action === "prompted") {
        await this.emitThought(session.id, "Considering your message...");
        await this.emitResponse(session.id, "Thanks for the additional context. Let me know if there's anything else I can help with.");
      }
    } catch (error) {
      console.error("handleSession failed:", error);
      await this.emitError(session.id, "An error occurred while processing your request.").catch(
        (e) => console.error("emitError failed:", e)
      );
    }
  }

  private async emitThought(sessionId: string, body: string): Promise<void> {
    await this.emitActivity(sessionId, { type: "thought", body });
  }

  private async emitResponse(sessionId: string, body: string): Promise<void> {
    await this.emitActivity(sessionId, { type: "response", body });
  }

  private async emitError(sessionId: string, body: string): Promise<void> {
    await this.emitActivity(sessionId, { type: "error", body });
  }

  private async emitActivity(
    sessionId: string,
    content: { type: string; body?: string; action?: string; parameter?: string }
  ): Promise<void> {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.LINEAR_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        query: AGENT_ACTIVITY_CREATE,
        variables: {
          input: {
            agentSessionId: sessionId,
            content,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${await response.text()}`);
    }
  }

  private async verifySignature(payload: string, signature: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.env.LINEAR_WEBHOOK_SIGNING_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    const expected = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (expected.length !== signature.length) return false;

    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= (expected.charCodeAt(i) ?? 0) ^ (signature.charCodeAt(i) ?? 0);
    }
    return mismatch === 0;
  }
}
