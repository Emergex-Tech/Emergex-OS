import { ApiError } from '../auth'
import { supabaseService } from '../supabaseServer'
import { isUuid } from '../ids'

export const MAX_TRACKER_BYTES = 4 * 1024 * 1024
/** A project in the caller's organisation plus its contract (if any) and deliverables — what every importer needs. */
export async function loadImportTarget(orgId: string, projectId: string) {
  if (!isUuid(projectId)) throw new ApiError(404, 'Project not found')
  const svc = supabaseService()
  const { data: project } = await svc.from('projects').select('id, name, deal_id, status').eq('id', projectId).eq('org_id', orgId).maybeSingle()
  if (!project) throw new ApiError(404, 'Project not found')
  const { data: contract } = await svc.from('contracts').select('id').eq('deal_id', project.deal_id).eq('org_id', orgId).maybeSingle()
  const { data: dels } = contract ? await svc.from('deliverables').select('id, description, period_label, status, planned_quantity, delivered_quantity, unit').eq('contract_id', contract.id).order('created_at') : { data: [] }
  return { project, contractId: contract?.id ?? null, deliverables: (dels ?? []).map((d) => ({ ...d, planned_quantity: Number(d.planned_quantity), delivered_quantity: Number(d.delivered_quantity) })) }
}
