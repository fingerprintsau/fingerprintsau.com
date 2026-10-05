CREATE TABLE `csvImportRows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`rowNumber` int NOT NULL,
	`listingId` int,
	`status` enum('processing','succeeded','skipped','failed') NOT NULL DEFAULT 'processing',
	`error` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `csvImportRows_id` PRIMARY KEY(`id`),
	CONSTRAINT `csv_import_rows_job_row_uq` UNIQUE(`jobId`,`rowNumber`)
);
--> statement-breakpoint
ALTER TABLE `csvImportJobs` MODIFY COLUMN `status` enum('queued','processing','interrupted','completed','failed') NOT NULL DEFAULT 'queued';--> statement-breakpoint
CREATE INDEX `csv_import_rows_job_status_idx` ON `csvImportRows` (`jobId`,`status`);