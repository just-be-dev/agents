import type { events } from "./schema.ts";

export interface AgentState {
  eventCount: number;
  lastEvent: {
    type: string;
    action: string;
    timestamp: string;
  } | null;
}

export type StoredEvent = typeof events.$inferSelect;
