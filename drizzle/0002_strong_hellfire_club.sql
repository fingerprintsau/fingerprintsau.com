CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`priceCents` int NOT NULL DEFAULT 0,
	`size` varchar(64),
	`condition` varchar(64) NOT NULL,
	`category` varchar(96),
	`sku` varchar(96),
	`status` enum('live','draft','review') NOT NULL DEFAULT 'draft',
	`imageUrls` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`)
);
