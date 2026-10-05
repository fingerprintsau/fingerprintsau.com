CREATE TABLE `bonusGrants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bonusCode` varchar(64) NOT NULL,
	`credits` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bonusGrants_id` PRIMARY KEY(`id`),
	CONSTRAINT `bonus_grants_user_code_uq` UNIQUE(`userId`,`bonusCode`)
);
--> statement-breakpoint
ALTER TABLE `usageLedger` ADD `reason` varchar(64);--> statement-breakpoint
CREATE INDEX `bonus_grants_user_id_idx` ON `bonusGrants` (`userId`);
CREATE INDEX `bonus_grants_user_id_idx` ON `bonusGrants` (`userId`);
