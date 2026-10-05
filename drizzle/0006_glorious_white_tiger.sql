CREATE TABLE `csvImportJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`fileName` varchar(180) NOT NULL,
	`mappingJson` text NOT NULL,
	`totalRows` int NOT NULL DEFAULT 0,
	`processedRows` int NOT NULL DEFAULT 0,
	`importedRows` int NOT NULL DEFAULT 0,
	`skippedRows` int NOT NULL DEFAULT 0,
	`failedRows` int NOT NULL DEFAULT 0,
	`errorRowsJson` text,
	`status` enum('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `csvImportJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `csvImportMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mappingJson` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `csvImportMappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `csv_import_mappings_user_id_uq` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `listings` ADD `photoStatus` enum('ok','photo_missing') DEFAULT 'ok' NOT NULL;--> statement-breakpoint
CREATE INDEX `csv_import_jobs_user_id_idx` ON `csvImportJobs` (`userId`);--> statement-breakpoint
CREATE INDEX `csv_import_jobs_user_status_idx` ON `csvImportJobs` (`userId`,`status`);