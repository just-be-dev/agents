export interface AgentState {
  sessionCount: number;
  lastSession: { id: string; action: string; timestamp: string } | null;
}

export interface LinearWebhookPayload {
  type: string;
  action: string;
  organizationId: string;
  agentSession: AgentSession;
  agentActivity?: AgentActivity;
}

export interface AgentSession {
  id: string;
  promptContext: string;
  issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
  };
}

export interface AgentActivity {
  body?: string;
  type: string;
}

export type StoredSession = {
  id: string;
  workspace_id: string;
  issue_id: string;
  issue_identifier: string;
  action: string;
  prompt_context: string;
  payload: string;
  timestamp: string;
};
