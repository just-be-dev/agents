import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: text().primaryKey(),
    type: text().notNull(),
    action: text().notNull().default(""),
    title: text().notNull().default(""),
    description: text().notNull().default(""),
    url: text().notNull().default(""),
    actor: text().notNull().default(""),
    payload: text().notNull(),
    installation_id: integer({ mode: "number" }),
    timestamp: text().notNull(),
  },
  (table) => [
    index("idx_events_timestamp").on(table.timestamp),
    index("idx_events_type").on(table.type),
  ]
);
