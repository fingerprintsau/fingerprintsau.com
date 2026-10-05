CREATE TABLE `aiBulkJobItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`listingId` int NOT NULL,
	`usageId` int,
	`status` enum('queued','processing','succeeded','failed','skipped') NOT NULL DEFAULT 'queued',
	`error` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiBulkJobItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_bulk_job_items_job_listing_uq` UNIQUE(`jobId`,`listingId`)
);
--> statement-breakpoint
CREATE TABLE `aiBulkJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`feature` enum('conditionReport','modelImage','video','listingCopy') NOT NULL,
	`prompt` text,
	`totalItems` int NOT NULL DEFAULT 0,
	`processedItems` int NOT NULL DEFAULT 0,
	`succeededItems` int NOT NULL DEFAULT 0,
	`failedItems` int NOT NULL DEFAULT 0,
	`skippedItems` int NOT NULL DEFAULT 0,
	`summaryJson` text,
	`status` enum('queued','processing','interrupted','completed','failed') NOT NULL DEFAULT 'queued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiBulkJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `listings` ADD `videoUsageId` int;--> statement-breakpoint
ALTER TABLE `listings` ADD `videoQueuedAt` timestamp;--> statement-breakpoint
CREATE INDEX `ai_bulk_job_items_job_status_idx` ON `aiBulkJobItems` (`jobId`,`status`);--> statement-breakpoint
CREATE INDEX `ai_bulk_jobs_user_id_idx` ON `aiBulkJobs` (`userId`);--> statement-breakpoint
CREATE INDEX `ai_bulk_jobs_user_status_idx` ON `aiBulkJobs` (`userId`,`status`);