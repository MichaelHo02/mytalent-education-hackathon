CREATE TABLE `workspace_states` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
