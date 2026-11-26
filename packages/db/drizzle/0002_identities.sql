CREATE TABLE `identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `identities_user_id_idx` ON `identities` (`user_id`);--> statement-breakpoint
INSERT INTO `identities`("provider", "subject", "user_id", "created_at") SELECT 'google', "google_sub", "id", "created_at" FROM `users`;--> statement-breakpoint
DROP INDEX `users_google_sub_unique`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `google_sub`;