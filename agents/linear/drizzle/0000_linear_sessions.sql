CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`issue_identifier` text NOT NULL,
	`action` text NOT NULL,
	`prompt_context` text NOT NULL,
	`payload` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_workspace` ON `sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_timestamp` ON `sessions` (`timestamp`);
