CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`created_by` text,
	`name` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `worlds_team_id_idx` ON `worlds` (`team_id`);