import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull(),
    issue_id: text().notNull(),
    issue_identifier: text().notNull(),
    action: text().notNull(),
    prompt_context: text().notNull(),
    payload: text().notNull(),
    timestamp: text().notNull(),
  },
  (table) => [
    index("idx_sessions_workspace").on(table.workspace_id),
    index("idx_sessions_timestamp").on(table.timestamp),
  ]
);
