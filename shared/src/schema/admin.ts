// Active Rating — target registration (admin) schemas (Phase 1 registration
// system). Used by the worker Admin API and by the scanner `register` CLI.

import { z } from 'zod';

export const RelationTypeSchema = z.enum([
  'self',
  'subsidiary',
  'supplier',
  'partner',
  'watch',
]);

/** Create/update an organization node in the tree. */
export const OrgUpsertSchema = z
  .object({
    id: z.string().min(1).optional(), // omit to mint a new ULID
    name: z.string().min(1),
    parent_id: z.string().min(1).nullable().optional(),
    relation_type: RelationTypeSchema,
    active_confirmed: z.boolean().default(false),
    slack_channel: z.string().min(1).nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

/** Create/update a seed domain under an organization. */
export const DomainUpsertSchema = z
  .object({
    id: z.string().min(1).optional(),
    org_id: z.string().min(1),
    fqdn: z.string().min(1),
    enabled: z.boolean().default(true),
  })
  .strict();

/** Forward-looking: per-asset context tagging (criticality / crown-jewel). */
export const AssetTagSchema = z
  .object({
    asset_id: z.string().min(1),
    criticality: z.enum(['crown', 'high', 'med', 'low', 'unknown']).optional(),
    data_sensitivity: z.string().optional(),
  })
  .strict();

/** Bulk GitOps registration document (targets.yaml, resolved). */
export const RegistrationDocSchema = z
  .object({
    organizations: z.array(
      z
        .object({
          key: z.string().min(1),
          name: z.string().min(1),
          parent: z.string().min(1).optional(),
          relation_type: RelationTypeSchema,
          active_confirmed: z.boolean().default(false),
          slack_channel: z.string().min(1).optional(),
          notes: z.string().optional(),
          domains: z
            .array(
              z.object({
                fqdn: z.string().min(1),
                enabled: z.boolean().default(true),
              }),
            )
            .default([]),
        })
        .strict(),
    ),
  })
  .strict();

export type OrgUpsert = z.infer<typeof OrgUpsertSchema>;
export type DomainUpsert = z.infer<typeof DomainUpsertSchema>;
export type AssetTag = z.infer<typeof AssetTagSchema>;
export type RegistrationDoc = z.infer<typeof RegistrationDocSchema>;
