// Active Rating — ingest client. Builds the signed POST /ingest request.

import { ulid } from 'ulidx';
import {
  signRequest,
  IngestPayloadSchema,
  INGEST_SCHEMA_VERSION,
  type EnrolledDomain,
  type IngestPayload,
  type NormalizedEntity,
  type Profile,
} from '@ar/shared';

export interface IngestResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export function buildPayload(opts: {
  domain: EnrolledDomain;
  adapter: string;
  authoritative: boolean;
  profile: Profile;
  entities: NormalizedEntity[];
  runAt?: string;
}): IngestPayload {
  const payload: IngestPayload = {
    schema_version: INGEST_SCHEMA_VERSION,
    domain_id: opts.domain.domain_id,
    organization_id: opts.domain.organization_id,
    source: {
      adapter: opts.adapter,
      is_authoritative: opts.authoritative,
      profile: opts.profile,
    },
    run_at: opts.runAt ?? new Date().toISOString(),
    run_id: ulid(),
    entities: opts.entities,
  };
  // Fail fast if we're about to send something invalid (mirrors worker check).
  IngestPayloadSchema.parse(payload);
  return payload;
}

export async function postIngest(opts: {
  ingestUrl: string;
  secret: string;
  payload: IngestPayload;
}): Promise<IngestResult> {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(opts.payload));
  const path = new URL(opts.ingestUrl).pathname; // must match the signed path
  const headers = await signRequest({
    secret: opts.secret,
    method: 'POST',
    path,
    bodyBytes,
  });
  const res = await fetch(opts.ingestUrl, { method: 'POST', headers, body: bodyBytes });
  // Read the body exactly once — a Response stream can't be re-read, so trying
  // res.json() then res.text() throws "Body has already been read" and masks the
  // real HTTP status. Read text, then parse it as JSON best-effort.
  const text = await res.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* leave body as the raw text */
    }
  }
  return { ok: res.ok, status: res.status, body };
}
