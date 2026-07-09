// Active Rating — Worker runtime bindings.

export interface Bindings {
  DB: D1Database;
  // Optional paid-tier bindings (see wrangler.toml). Absent on the free tier:
  // evidence falls back to inline proof_json in D1; re-eval queue is skipped.
  EVIDENCE?: R2Bucket;
  REEVAL_QUEUE?: Queue<ReevalMessage>;
  // vars
  OFFLINE: string;
  SLACK_ENABLED: string;
  ADMIN_USER?: string; // admin account name for the dashboard login (default "ar-admin")
  // secrets
  INGEST_HMAC_SECRET: string;
  ADMIN_TOKEN: string;
  SLACK_WEBHOOK_URL?: string;
}

export interface ReevalMessage {
  asset_id: string;
  reason: string;
}
