CREATE TABLE `storefrontBlocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`blockType` varchar(64) NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` text,
	`configJson` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isVisible` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storefrontBlocks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usageLedger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`feature` varchar(64) NOT NULL,
	`provider` varchar(64),
	`units` int NOT NULL DEFAULT 1,
	`amountCents` int NOT NULL DEFAULT 0,
	`status` enum('reserved','succeeded','failed') NOT NULL DEFAULT 'reserved',
	`stripePaymentIntentId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usageLedger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `stripeCustomerId` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `stripeSubscriptionId` varchar(255);