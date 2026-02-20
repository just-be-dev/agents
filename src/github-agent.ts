import { Agent, callable } from "agents";
import type { AgentState, StoredEvent } from "./types.ts";

export class GitHubAgent extends Agent<Env, AgentState> {
  override initialState: AgentState = {
    eventCount: 0,
    lastEvent: null,
  };

  override onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL,
        installation_id INTEGER,
        timestamp TEXT NOT NULL
      )
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp
      ON events(timestamp DESC)
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_events_type
      ON events(type)
    `;
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
    const eventType = request.headers.get("x-github-event") ?? "unknown";

    if (!deliveryId) {
      return new Response("Missing delivery ID", { status: 400 });
    }

    // Deduplicate by delivery ID
    const existing = this.sql`SELECT id FROM events WHERE id = ${deliveryId}`;
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

    this.sql`
      INSERT INTO events (id, type, action, title, description, url, actor, payload, installation_id, timestamp)
      VALUES (${deliveryId}, ${eventType}, ${action}, ${title}, ${description}, ${url}, ${actor}, ${body}, ${installationId}, ${new Date().toISOString()})
    `;

    // Update agent state (broadcasts to WebSocket clients)
    const countResult = this.sql<{ count: number }>`SELECT COUNT(*) as count FROM events`;
    this.setState({
      eventCount: countResult[0]?.count ?? 0,
      lastEvent: {
        type: eventType,
        action,
        timestamp: new Date().toISOString(),
      },
    });

    // Handle specific events
    await this.handleEvent(eventType, action, payload);

    return new Response("OK", { status: 200 });
  }

  @callable()
  getEvents(limit = 20): StoredEvent[] {
    return this.sql<StoredEvent>`
      SELECT * FROM events
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
  }

  @callable()
  getEventsByType(type: string, limit = 20): StoredEvent[] {
    return this.sql<StoredEvent>`
      SELECT * FROM events
      WHERE type = ${type}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
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

  private async getOctokit(installationId: number) {
    const { Octokit } = await import("octokit");
    const { createAppAuth } = await import("@octokit/auth-app");

    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.env.GITHUB_APP_ID,
        privateKey: this.env.GITHUB_PRIVATE_KEY,
        installationId,
      },
    });
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
