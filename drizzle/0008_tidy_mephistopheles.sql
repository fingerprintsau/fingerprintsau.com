ALTER TABLE `listings` ADD `tagsJson` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `conditionReportJson` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `videoStatus` enum('none','queued','ready','failed') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `videoUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `listings` ADD `videoRequestId` varchar(255);