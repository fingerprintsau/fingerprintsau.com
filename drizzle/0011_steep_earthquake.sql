CREATE TABLE `officeFiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`fileType` enum('doc','sheet') NOT NULL,
	`snapshotJson` text NOT NULL,
	`sourceKey` varchar(500),
	`sourceMimeType` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `officeFiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `office_files_user_id_idx` ON `officeFiles` (`userId`);--> statement-breakpoint
CREATE INDEX `office_files_user_updated_idx` ON `officeFiles` (`userId`,`updatedAt`);