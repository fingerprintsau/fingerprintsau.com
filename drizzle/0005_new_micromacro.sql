CREATE TABLE `storefrontSlugHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`slug` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storefrontSlugHistory_id` PRIMARY KEY(`id`),
	CONSTRAINT `storefront_slug_history_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `displayName` varchar(160);--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `users` ADD `suburb` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `state` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `profileImageUrl` varchar(500);--> statement-breakpoint
CREATE INDEX `storefront_slug_history_user_id_idx` ON `storefrontSlugHistory` (`userId`);