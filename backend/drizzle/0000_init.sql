CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"content" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "attachments_user_id_conversation_id_id_pk" PRIMARY KEY("user_id","conversation_id","id")
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "comparisons_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "connections_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"connection_id" text,
	"allow_charges" boolean DEFAULT false NOT NULL,
	"settings" jsonb NOT NULL,
	"workbench" jsonb,
	"branch_of" jsonb,
	"extra" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "conversations_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "documents_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" bigint NOT NULL,
	"metadata" jsonb,
	"provenance" jsonb,
	"run_id" text,
	"run_status" text,
	"finish_reason" text,
	"feedback" text,
	CONSTRAINT "messages_user_id_conversation_id_id_pk" PRIMARY KEY("user_id","conversation_id","id")
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "presets_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" bigint NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "runs_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"imported_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_conversation_id_conversations_user_id_id_fk" FOREIGN KEY ("user_id","conversation_id") REFERENCES "public"."conversations"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_conversation_id_conversations_user_id_id_fk" FOREIGN KEY ("user_id","conversation_id") REFERENCES "public"."conversations"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comparisons_created_idx" ON "comparisons" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_updated_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_order_idx" ON "messages" USING btree ("user_id","conversation_id","position");--> statement-breakpoint
CREATE INDEX "runs_started_idx" ON "runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");