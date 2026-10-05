CREATE TABLE `deletedStorageKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deletedStorageKeys_id` PRIMARY KEY(`id`),
	CONSTRAINT `deleted_storage_keys_key_uq` UNIQUE(`storageKey`)
);
--> statement-breakpoint
ALTER TABLE `officeFiles` ADD `sizeBytes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `deleted_storage_keys_user_id_idx` ON `deletedStorageKeys` (`userId`);