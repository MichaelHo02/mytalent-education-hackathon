import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceStates = sqliteTable("workspace_states", {
  ownerId: text("owner_id").primaryKey(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
