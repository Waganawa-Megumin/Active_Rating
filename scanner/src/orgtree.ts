// Active Rating — enrollment loader. The orchestrator reads scan targets from
// the registration store (worker /api/enrollment), NOT a hardcoded list.

import { z } from 'zod';
import type { EnrolledDomain, RelationType } from '@ar/shared';

const EnrollmentRowSchema = z.object({
  domain_id: z.string(),
  organization_id: z.string(),
  fqdn: z.string(),
  relation_type: z.enum(['self', 'subsidiary', 'supplier', 'partner', 'watch']),
  active_confirmed: z.boolean(),
  slack_channel: z.string().nullable().optional(),
});

export async function loadEnrollment(apiBase: string): Promise<EnrolledDomain[]> {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/enrollment`);
  if (!res.ok) throw new Error(`enrollment fetch failed: HTTP ${res.status}`);
  const rows = z.array(EnrollmentRowSchema).parse(await res.json());
  return rows.map((r) => ({
    domain_id: r.domain_id,
    organization_id: r.organization_id,
    fqdn: r.fqdn,
    relation_type: r.relation_type as RelationType,
    active_confirmed: r.active_confirmed,
    slack_channel: r.slack_channel ?? null,
  }));
}
