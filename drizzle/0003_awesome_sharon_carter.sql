CREATE TABLE `stripeCheckoutSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(255) NOT NULL,
	`userId` int NOT NULL,
	`credits` int NOT NULL,
	`creditsGrantedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripeCheckoutSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_checkout_session_id_uq` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `stripeWebhookEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(255) NOT NULL,
	`sessionId` varchar(255),
	`eventType` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripeWebhookEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_webhook_event_id_uq` UNIQUE(`eventId`)
);
--> statement-breakpoint
ALTER TABLE `usageLedger` ADD `freeUnits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `storeSlug` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_store_slug_uq` UNIQUE(`storeSlug`);--> statement-breakpoint
CREATE INDEX `stripe_checkout_user_id_idx` ON `stripeCheckoutSessions` (`userId`);--> statement-breakpoint
CREATE INDEX `stripe_webhook_session_id_idx` ON `stripeWebhookEvents` (`sessionId`);--> statement-breakpoint
CREATE INDEX `listings_user_id_idx` ON `listings` (`userId`);--> statement-breakpoint
CREATE INDEX `storefront_blocks_user_id_idx` ON `storefrontBlocks` (`userId`);--> statement-breakpoint
CREATE INDEX `usage_ledger_user_id_idx` ON `usageLedger` (`userId`);