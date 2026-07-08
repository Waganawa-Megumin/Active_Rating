// Active Rating — Worker runtime bindings.

export interface Bindings {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  REEVAL_QUEUE?: Queue<ReevalMessage>;
  // vars
  OFFLINE: string;
  SLACK_ENABLED: string;
  // secrets
  INGEST_HMAC_SECRET: string;
  ADMIN_TOKEN: string;
  SLACK_WEBHOOK_URL?: string;
}

export interface ReevalMessage {
  asset_id: string;
  reason: string;
}
