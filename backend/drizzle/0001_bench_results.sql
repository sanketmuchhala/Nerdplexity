CREATE TABLE "bench_results" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"connection_id" text NOT NULL,
	"model" text NOT NULL,
	"item_id" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"latency_ms" integer,
	"ttft_ms" integer,
	"at" bigint NOT NULL,
	CONSTRAINT "bench_results_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "bench_results" ADD CONSTRAINT "bench_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bench_results_model_idx" ON "bench_results" USING btree ("user_id","connection_id","model");--> statement-breakpoint
CREATE INDEX "bench_results_at_idx" ON "bench_results" USING btree ("user_id","at");