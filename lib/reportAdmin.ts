import { ApiError } from './auth'
import { supabaseService } from './supabaseServer'
import { isUuid } from './ids'
import type { ReportProject } from './reportService'

/** Loads a project in the caller's organisation, or a 404 that does not say which part was wrong. */
export async function loadReportProject(orgId: string, id: string): Promise<ReportProject> {
  if (!isUuid(id)) throw new ApiError(404, 'Project not found')
  const { data } = await supabaseService().from('projects').select('id, name, deal_id, status').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Project not found')
  return data
}
