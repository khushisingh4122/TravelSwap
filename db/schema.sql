PRAGMA foreign_keys = ON;
CREATE TABLE interests (user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(user_id), direction TEXT NOT NULL CHECK(direction IN ('INR-TWD','TWD-INR')), travel_month TEXT NOT NULL, consent_version TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE profiles (user_id TEXT PRIMARY KEY NOT NULL, public_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE listings (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES profiles(user_id), have TEXT NOT NULL CHECK(have IN ('INR','TWD','AUD')), need TEXT NOT NULL CHECK(need IN ('INR','TWD','AUD') AND need<>have), amount INTEGER NOT NULL CHECK(amount BETWEEN 100 AND 100000000), wanted INTEGER NOT NULL CHECK(wanted BETWEEN 100 AND 100000000), city TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','matched','hidden')), created_at INTEGER NOT NULL);
CREATE INDEX idx_listings_match ON listings(status,have,need,end_date);
CREATE INDEX idx_listings_owner ON listings(owner_id,created_at);
CREATE TABLE requests (id TEXT PRIMARY KEY NOT NULL, listing_id TEXT NOT NULL REFERENCES listings(id), sender_id TEXT NOT NULL REFERENCES profiles(user_id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled')), created_at INTEGER NOT NULL, UNIQUE(listing_id,sender_id));
CREATE INDEX idx_requests_sender ON requests(sender_id,created_at);
CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL REFERENCES requests(id), sender_id TEXT NOT NULL REFERENCES profiles(user_id), body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX idx_messages_request ON messages(request_id,created_at,id);
CREATE TABLE blocks (owner_id TEXT NOT NULL REFERENCES profiles(user_id), target_id TEXT NOT NULL REFERENCES profiles(user_id), created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,target_id));
CREATE INDEX idx_blocks_target ON blocks(target_id,owner_id);
CREATE TABLE reports (id TEXT PRIMARY KEY NOT NULL, reporter_id TEXT NOT NULL REFERENCES profiles(user_id), target_id TEXT NOT NULL REFERENCES profiles(user_id), listing_id TEXT REFERENCES listings(id), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
CREATE INDEX idx_reports_created ON reports(created_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL);
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

