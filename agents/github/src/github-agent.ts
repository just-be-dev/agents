import { Agent, callable } from "agents";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { count, eq, desc } from "drizzle-orm";
import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { events } from "./schema.ts";
import migrations from "./migrations.ts";
import type { AgentState, StoredEvent } from "./types.ts";

export class GitHubAgent extends Agent<Env, AgentState> {
  db!: DrizzleSqliteDODatabase;
  private oktokitCache = new Map<number, Octokit>();

  override initialState: AgentState = {
    eventCount: 0,
    lastEvent: null,
  };

  override async onStart() {
    this.db = drizzle(this.ctx.storage);
    await migrate(this.db, migrations);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = request.headers.get("x-hub-signature-256");
    const body = await request.text();

    if (!signature || !(await this.verifySignature(body, signature))) {
      return new Response("Invalid signature", { status: 401 });
    }

    const deliveryId = request.headers.get("x-github-delivery");
    const eventType = request.headers.get("x-github-event");

    if (!eventType) {
      return new Response("Missing x-github-event header", { status: 400 });
    }

    if (!deliveryId) {
      return new Response("Missing delivery ID", { status: 400 });
    }

    // Deduplicate by delivery ID
    const existing = this.db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, deliveryId))
      .all();
    if (existing.length > 0) {
      return new Response("Event already processed", { status: 200 });
    }

    const payload = JSON.parse(body);
    const action = payload.action ?? "";
    const installationId: number | null = payload.installation?.id ?? null;

    const { title, description, url, actor } = this.extractEventInfo(
      eventType,
      payload
    );

    this.db.insert(events).values({
      id: deliveryId,
      type: eventType,
      action,
      title,
      description,
      url,
      actor,
      payload: body,
      installation_id: installationId,
      timestamp: new Date().toISOString(),
    }).run();

    // Update agent state (broadcasts to WebSocket clients)
    const countResult = this.db
      .select({ count: count() })
      .from(events)
      .all();
    this.setState({
      eventCount: countResult[0]?.count ?? 0,
      lastEvent: {
        type: eventType,
        action,
        timestamp: new Date().toISOString(),
      },
    });

    // Handle specific events — errors here must not affect the 200 response;
    // the event is already stored and deduplication would skip a retry.
    try {
      await this.handleEvent(eventType, action, payload);
    } catch (error) {
      console.error("handleEvent failed:", error);
    }

    return new Response("OK", { status: 200 });
  }

  @callable()
  getEvents(limit = 20, offset = 0): StoredEvent[] {
    return this.db
      .select()
      .from(events)
      .orderBy(desc(events.timestamp))
      .limit(limit)
      .offset(offset)
      .all();
  }

  @callable()
  getEventsByType(type: string, limit = 20, offset = 0): StoredEvent[] {
    return this.db
      .select()
      .from(events)
      .where(eq(events.type, type))
      .orderBy(desc(events.timestamp))
      .limit(limit)
      .offset(offset)
      .all();
  }

  @callable()
  async commentOnIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
    installationId: number
  ): Promise<{ id: number }> {
    const octokit = await this.getOctokit(installationId);
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return { id: response.data.id };
  }

  @callable()
  async addLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
    installationId: number
  ): Promise<void> {
    const octokit = await this.getOctokit(installationId);
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
  }

  @callable()
  async createReaction(
    owner: string,
    repo: string,
    issueNumber: number,
    reaction:
      | "+1"
      | "-1"
      | "laugh"
      | "confused"
      | "heart"
      | "hooray"
      | "rocket"
      | "eyes",
    installationId: number
  ): Promise<void> {
    const octokit = await this.getOctokit(installationId);
    await octokit.rest.reactions.createForIssue({
      owner,
      repo,
      issue_number: issueNumber,
      content: reaction,
    });
  }

  // --- Internal methods ---

  private async handleEvent(
    eventType: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    // Example handler: welcome comment on new issues
    if (eventType === "issues" && action === "opened") {
      const issue = payload.issue as {
        number: number;
        user: { login: string };
      };
      const repo = payload.repository as {
        name: string;
        owner: { login: string };
      };
      const installationId = (payload.installation as { id: number })?.id;

      if (installationId) {
        try {
          await this.commentOnIssue(
            repo.owner.login,
            repo.name,
            issue.number,
            `Thanks for opening this issue, @${issue.user.login}! We'll take a look soon.`,
            installationId
          );
        } catch (error) {
          console.error("Failed to post welcome comment:", error);
        }
      }
    }
  }

  private getOctokit(installationId: number): Octokit {
    const cached = this.oktokitCache.get(installationId);
    if (cached) return cached;

    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.env.GITHUB_APP_ID,
        privateKey: this.env.GITHUB_PRIVATE_KEY,
        installationId,
      },
    });
    this.oktokitCache.set(installationId, client);
    return client;
  }

  private async verifySignature(
    payload: string,
    signature: string
  ): Promise<boolean> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.env.GITHUB_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    const expected = `sha256=${Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;

    // Constant-time comparison
    if (expected.length !== signature.length) return false;

    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  }

  private extractEventInfo(
    eventType: string,
    payload: Record<string, unknown>
  ): {
    title: string;
    description: string;
    url: string;
    actor: string;
  } {
    const sender = payload.sender as { login: string } | undefined;
    const actor = sender?.login ?? "unknown";

    switch (eventType) {
      case "issues": {
        const issue = payload.issue as {
          title: string;
          body?: string;
          html_url: string;
        };
        return {
          title: issue?.title ?? "",
          description: (issue?.body ?? "").slice(0, 500),
          url: issue?.html_url ?? "",
          actor,
        };
      }
      case "pull_request": {
        const pr = payload.pull_request as {
          title: string;
          body?: string;
          html_url: string;
        };
        return {
          title: pr?.title ?? "",
          description: (pr?.body ?? "").slice(0, 500),
          url: pr?.html_url ?? "",
          actor,
        };
      }
      case "push": {
        const commits = payload.commits as { message: string }[] | undefined;
        const ref = payload.ref as string;
        return {
          title: `Push to ${ref}`,
          description: commits?.[0]?.message ?? "",
          url: (payload.compare as string) ?? "",
          actor,
        };
      }
      default:
        return {
          title: `${eventType} event`,
          description: "",
          url: "",
          actor,
        };
    }
  }
}
