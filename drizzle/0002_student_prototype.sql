ALTER TABLE profiles ADD COLUMN country TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN preferred_currency TEXT NOT NULL DEFAULT 'INR';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN destination TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN travel_month TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE listings ADD COLUMN origin TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE listings ADD COLUMN destination TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE listings ADD COLUMN deleted_at INTEGER;
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN source_listing_id TEXT REFERENCES listings(id);
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN completed_at INTEGER;
--> statement-breakpoint
CREATE TABLE notifications (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES profiles(user_id), request_id TEXT REFERENCES requests(id), kind TEXT NOT NULL, body TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_notifications_user ON notifications(user_id,created_at);

