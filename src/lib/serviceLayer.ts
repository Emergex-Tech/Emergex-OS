import { supabaseService } from './supabaseServer'
import { ApiError } from './auth'
import { createRecordFolder } from './googleDrive'
import type { Profile } from '@/types/db'

/**
 * Non-throwing permission check — used where the caller branches on the
 * result (e.g. "does this role's change auto-approve?") rather than
 * blocking the request. requirePermission wraps this for the common
 * "throw if missing" case.
 */
export async function hasPermission(profile: Profile, permissionKey: string): Promise<boolean> {
  const svc = supabaseService()
  const { data } = await svc
    .from('role_permissions')
    .select('permission_key')
    .eq('role_key', profile.role_key)
    .eq('permission_key', permissionKey)
    .maybeSingle()
  return !!data
}

/**
 * Throws if the calling profile's role doesn't have this permission.
 * Permissions are rows in role_permissions (see schema.sql) — adding a
 * role (Manager/CEO in 2A, Agent in 2B, Brand in 4) is a data change,
 * never a change to this function.
 */
export async function requirePermission(profile: Profile, permissionKey: string) {
  if (!(await hasPermission(profile, permissionKey))) {
    throw new ApiError(403, `Role '${profile.role_key}' lacks permission '${permissionKey}'`)
  }
}

/** Universal audit log — every service-layer write calls this. */
export async function writeAudit(params: {
  orgId: string
  actorId: string
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
}) {
  const svc = supabaseService()
  await svc.from('audit_events').insert({
    org_id: params.orgId,
    actor_id: params.actorId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId,
    before: params.before ?? null,
    after: params.after ?? null
  })
}

/**
 * Universal versioning — every record type funnels through record_versions
 * instead of each table needing its own version table (PRD 6.3: "one
 * current version and full change history" for every record).
 */
export async function writeVersion(params: {
  orgId: string
  entityType: string
  entityId: string
  snapshot: unknown
  changedBy: string
  diffSummary?: string
}) {
  const svc = supabaseService()
  const { count } = await svc
    .from('record_versions')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', params.entityType)
    .eq('entity_id', params.entityId)

  await svc.from('record_versions').insert({
    org_id: params.orgId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    version_number: (count ?? 0) + 1,
    snapshot: params.snapshot,
    changed_by: params.changedBy,
    diff_summary: params.diffSummary ?? null
  })
}

/**
 * Runs the DB's trigram similarity check (see functions.sql) and, if a
 * plausible duplicate is found, writes a duplicate_candidates row for
 * Management to review — it does not block or merge automatically.
 */
export async function flagIfDuplicate(params: {
  orgId: string
  entityType: 'property' | 'vendor'
  entityId: string
  name: string
}) {
  const svc = supabaseService()
  const rpcName = params.entityType === 'property' ? 'find_similar_properties' : 'find_similar_vendors'
  const { data: candidates } = await svc.rpc(rpcName, {
    p_org_id: params.orgId,
    p_name: params.name,
    p_exclude_id: params.entityId
  })

  for (const candidate of candidates ?? []) {
    await svc.from('duplicate_candidates').insert({
      org_id: params.orgId,
      entity_type: params.entityType,
      entity_id_a: params.entityId,
      entity_id_b: candidate.id,
      similarity_score: candidate.similarity
    })
  }
}

/** The Drive folder id already recorded for a record, if any. Folder rows have no drive_file_id. */
export async function findFolderId(orgId: string, entityType: string, entityId: string): Promise<string | null> {
  const svc = supabaseService()
  const { data } = await svc
    .from('files')
    .select('drive_folder_id')
    .eq('org_id', orgId).eq('linked_type', entityType).eq('linked_id', entityId)
    .is('drive_file_id', null)
    .limit(1)
    .maybeSingle()
  return data?.drive_folder_id ?? null
}

/** Finds the record's folder, creating it (best effort) if missing. Null means Drive isn't usable right now. */
export async function ensureFolderId(params: {
  orgId: string; actorId: string; entityType: 'proposal'; entityId: string; folderName: string
}): Promise<string | null> {
  const found = await findFolderId(params.orgId, params.entityType, params.entityId)
  if (found) return found
  await tryCreateDriveFolder(params)
  return findFolderId(params.orgId, params.entityType, params.entityId)
}

/**
 * Best-effort Drive folder creation: called after a record is already
 * committed, so a Drive outage or missing credentials never blocks or
 * rolls back the actual record. Failures are written to audit_events as
 * their own event (action: 'drive_folder_failed') so Management can see
 * and retry via POST /api/drive-folders, rather than failing silently.
 */
export async function tryCreateDriveFolder(params: {
  orgId: string
  actorId: string
  entityType: 'vendor' | 'brand' | 'agent' | 'property' | 'proposal'
  entityId: string
  folderName: string
}) {
  const svc = supabaseService()
  try {
    // Idempotent: a retry must not create a second folder row for the same record.
    const existing = await findFolderId(params.orgId, params.entityType, params.entityId)
    if (existing) return
    const { folderId, folderUrl } = await createRecordFolder({ entityType: params.entityType, folderName: params.folderName })
    await svc.from('files').insert({
      org_id: params.orgId,
      linked_type: params.entityType,
      linked_id: params.entityId,
      drive_folder_id: folderId,
      name: params.folderName,
      uploaded_by: params.actorId
    })
    await writeAudit({
      orgId: params.orgId, actorId: params.actorId, action: 'drive_folder_created',
      entityType: params.entityType, entityId: params.entityId, after: { folderId, folderUrl }
    })
  } catch (err) {
    await writeAudit({
      orgId: params.orgId, actorId: params.actorId, action: 'drive_folder_failed',
      entityType: params.entityType, entityId: params.entityId,
      after: { error: err instanceof Error ? err.message : String(err) }
    })
  }
}

/** Which column (if any) records "who created this row", per table. Verified against the real schema. */
export const ACTOR_COLUMN: Record<string, string | null> = {
  properties: 'created_by', items: 'created_by', routes: 'created_by', proposals: 'created_by',
  price_records: 'recorded_by', shares: 'logged_by', intel_notes: 'submitted_by',
  vendors: null, brands: null, agents: null // no actor column on these tables (vendors carry owner_id instead)
}

/**
 * The generic "create a record" flow every API route composes:
 * permission check -> insert -> audit -> version -> (optional) duplicate flag
 * -> (optional) Drive folder.
 * Individual routes still validate their own request bodies before calling this.
 */
export async function createRecord(params: {
  profile: Profile
  permission: string
  table: string
  entityType: string
  data: Record<string, unknown>
  duplicateCheck?: { entityType: 'property' | 'vendor'; nameField: string }
  driveFolder?: { entityType: 'vendor' | 'brand' | 'agent' | 'property'; nameField: string }
}) {
  await requirePermission(params.profile, params.permission)
  const svc = supabaseService()

  // Not every table has a created_by: price_records use recorded_by, shares use
  // logged_by, and so on. Forcing created_by onto every insert failed on 6 of the
  // 10 tables that go through here (found by running the schema on a real Postgres).
  const actorColumn = ACTOR_COLUMN[params.table] ?? null
  const { data: inserted, error } = await svc
    .from(params.table)
    .insert({
      ...params.data,
      org_id: params.profile.org_id,
      ...(actorColumn ? { [actorColumn]: params.profile.id } : {})
    })
    .select()
    .single()

  if (error) throw new ApiError(400, error.message)

  await writeAudit({
    orgId: params.profile.org_id,
    actorId: params.profile.id,
    action: 'create',
    entityType: params.entityType,
    entityId: inserted.id,
    after: inserted
  })
  await writeVersion({
    orgId: params.profile.org_id,
    entityType: params.entityType,
    entityId: inserted.id,
    snapshot: inserted,
    changedBy: params.profile.id,
    diffSummary: 'Initial creation'
  })

  if (params.duplicateCheck) {
    await flagIfDuplicate({
      orgId: params.profile.org_id,
      entityType: params.duplicateCheck.entityType,
      entityId: inserted.id,
      name: String(inserted[params.duplicateCheck.nameField])
    })
  }

  if (params.driveFolder) {
    // Fire-and-await, but never throws past this point — see tryCreateDriveFolder.
    await tryCreateDriveFolder({
      orgId: params.profile.org_id,
      actorId: params.profile.id,
      entityType: params.driveFolder.entityType,
      entityId: inserted.id,
      folderName: String(inserted[params.driveFolder.nameField])
    })
  }

  return inserted
}

export async function updateRecord(params: {
  profile: Profile
  permission: string
  table: string
  entityType: string
  id: string
  data: Record<string, unknown>
  diffSummary?: string
}) {
  await requirePermission(params.profile, params.permission)
  const svc = supabaseService()

  const { data: before } = await svc.from(params.table).select('*').eq('id', params.id).single()

  const { data: after, error } = await svc
    .from(params.table)
    .update({ ...params.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('org_id', params.profile.org_id) // belt-and-braces: can't update across orgs even with the service key
    .select()
    .single()

  if (error) throw new ApiError(400, error.message)

  await writeAudit({
    orgId: params.profile.org_id,
    actorId: params.profile.id,
    action: 'update',
    entityType: params.entityType,
    entityId: params.id,
    before,
    after
  })
  await writeVersion({
    orgId: params.profile.org_id,
    entityType: params.entityType,
    entityId: params.id,
    snapshot: after,
    changedBy: params.profile.id,
    diffSummary: params.diffSummary
  })

  return after
}
