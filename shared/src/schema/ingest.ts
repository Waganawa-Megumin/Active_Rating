// Active Rating — ingest payload schema (design v1.0 §9). Validated on both
// sides: scanner validates before POST (fail fast in CI); worker validates
// after HMAC verification (422 on failure).

import { z } from 'zod';

export const INGEST_SCHEMA_VERSION = 1;

export const EntityTypeSchema = z.enum([
  'subdomain',
  'dns',
  'service',
  'cert',
  'web',
  'exposure',
  'asn',
  'vpn',
]);

export const ProfileSchema = z.enum(['active', 'passive']);

export const ConfidenceSignalsSchema = z
  .object({
    source_count: z.number().int().nonnegative().optional(),
    active_resolved: z.boolean().optional(),
    in_owned_asn: z.boolean().optional(),
    cert_org_match: z.boolean().optional(),
    not_wildcard: z.boolean().optional(),
    parked: z.boolean().optional(),
    shared_cdn: z.boolean().optional(),
  })
  .strict();

export const NormalizedEntitySchema = z
  .object({
    entity_type: EntityTypeSchema,
    identity: z.string().min(1),
    attributes: z.record(z.unknown()),
    observed_at: z.string().datetime({ offset: true }),
    raw_ref: z.string().optional(),
    signals: ConfidenceSignalsSchema.optional(),
  })
  .strict();

export const IngestSourceSchema = z
  .object({
    adapter: z.string().min(1), // crt.sh | offline | intelx | shodan | hibp | ...
    is_authoritative: z.boolean(),
    profile: ProfileSchema,
  })
  .strict();

export const IngestPayloadSchema = z
  .object({
    schema_version: z.literal(INGEST_SCHEMA_VERSION),
    domain_id: z.string().min(1),
    organization_id: z.string().min(1),
    source: IngestSourceSchema,
    run_at: z.string().datetime({ offset: true }),
    run_id: z.string().min(1),
    entities: z.array(NormalizedEntitySchema).max(50_000),
  })
  .strict();

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
export type IngestSource = z.infer<typeof IngestSourceSchema>;
