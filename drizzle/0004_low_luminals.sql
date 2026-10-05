CREATE INDEX `listings_user_created_idx` ON `listings` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `listings_user_status_idx` ON `listings` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `listings_user_category_idx` ON `listings` (`userId`,`category`);--> statement-breakpoint
CREATE INDEX `listings_user_condition_idx` ON `listings` (`userId`,`condition`);