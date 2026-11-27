ALTER TABLE `api_keys` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `api_keys` SET `updated_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `identities` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `identities` SET `updated_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `memberships` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `memberships` SET `updated_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `updated_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `teams` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `teams` SET `updated_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `users` SET `updated_at` = `created_at`;
