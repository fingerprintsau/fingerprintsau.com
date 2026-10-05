CREATE INDEX `listings_status_created_idx` ON `listings` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `listings_status_category_idx` ON `listings` (`status`,`category`);--> statement-breakpoint
CREATE INDEX `listings_status_price_idx` ON `listings` (`status`,`priceCents`);