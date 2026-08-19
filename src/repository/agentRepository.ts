import { apiRequest } from './apiClient'

export type AgentRunStatus =
  | 'created'
  | 'planning'
  | 'contextualizing'
  | 'executing_tools'
  | 'awaiting_approval'
  | 'applying'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled'
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AgentFindingSeverity = 'success' | 'info' | 'warning' | 'critical'
export type AgentRunMode = 'read_only' | 'plan_design'
export type PatchStatus =
  | 'proposed'
  | 'validated'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed'
  | 'superseded'
  | 'rolled_back'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface AgentEvidence {
  label: string
  value: string
  object_id?: string | null
}

export interface AgentFinding {
  id: string
  category: string
  severity: AgentFindingSeverity
  title: string
  detail: string
  evidence: AgentEvidence[]
  object_ids: string[]
  recommendation: string
}

export interface AgentAnalysisResult {
  headline: string
  assessment: string
  confidence: number
  snapshot: {
    factory_id: string
    factory_name: string
    factory_version: string
    dimensions_m: { width: number; length: number }
    floor_count: number
    object_count: number
    object_counts: Record<string, number>
    item_count: number
    recipe_count: number
    enabled_recipe_count: number
    inventory_record_count: number
    simulation_status: string
    elapsed_sim_sec: number
  }
  graph_summary: {
    node_count: number
    edge_count: number
    invalid_reference_count: number
    node_counts: Record<string, number>
    edge_counts: Record<string, number>
  }
  metrics: {
    throughput_per_min: number
    work_in_progress: number
    finished_goods: number
    elapsed_sim_sec: number
    sample_count: number
  }
  findings: AgentFinding[]
}

export interface FactoryGoalMetric {
  key: string
  operator: 'eq' | 'gte' | 'lte' | 'minimize' | 'maximize'
  target: number | null
  unit: string
  hard: boolean
  source: string
}

export interface FactoryGoalConstraint {
  key: string
  operator: string
  value: number | string | boolean | null
  unit: string | null
  hard: boolean
  source: string
}

export interface FactoryGoal {
  goal_schema_version: number
  compiler: string
  objective: string
  intent: 'diagnose' | 'explain' | 'optimize' | 'monitor'
  status: 'ready' | 'needs_clarification' | 'conflicting'
  baseline_version: string
  metrics: FactoryGoalMetric[]
  hard_constraints: FactoryGoalConstraint[]
  soft_constraints: FactoryGoalConstraint[]
  time_horizon_sec: number
  allowed_actions: string[]
  assumptions: string[]
  missing_constraints: string[]
  conflicts: Array<{ code: string; message: string; sources: string[] }>
}

export interface AgentStep {
  id: string
  position: number
  key: string
  title: string
  status: AgentStepStatus
  detail: string
  started_at: string | null
  completed_at: string | null
}

export interface AgentToolCall {
  id: string
  step_id: string | null
  tool_name: string
  status: AgentStepStatus
  attempt: number
  input_data: Record<string, unknown>
  output_data: Record<string, unknown>
  error: string | null
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

export interface FactoryPatchOp {
  op_id: string
  kind: 'move_object' | 'update_config' | 'adjust_inventory' | 'add_object' | 'remove_object'
  object_id?: string | null
  params: Record<string, unknown>
  preconditions: Array<Record<string, unknown>>
  risk: RiskLevel
  summary: string
}

export interface AgentApproval {
  id: string
  patch_id: string
  run_id: string
  owner_id: string
  status: ApprovalStatus
  summary: string
  risk_level: RiskLevel
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export interface AgentPatch {
  id: string
  run_id: string
  factory_id: string
  owner_id: string
  base_version: string
  status: PatchStatus
  risk_level: RiskLevel
  idempotency_key: string
  operations: FactoryPatchOp[]
  inverse_operations: FactoryPatchOp[]
  preconditions: Array<Record<string, unknown>>
  impact: Record<string, unknown>
  validation: {
    ok?: boolean
    errors?: string[]
    warnings?: string[]
  } & Record<string, unknown>
  diff_summary: {
    operation_count?: number
    moved_object_count?: number
    config_change_count?: number
    inventory_change_count?: number
    added_object_count?: number
    removed_object_count?: number
    operations?: Array<{ op_id?: string; kind?: string; summary?: string; risk?: string }>
  } & Record<string, unknown>
  applied_factory_updated_at: string | null
  error: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
  applied_at: string | null
  approvals: AgentApproval[]
}

export interface AgentRun {
  id: string
  owner_id: string
  factory_id: string
  objective: string
  mode: AgentRunMode
  status: AgentRunStatus
  provider: string
  llm_configured: boolean
  base_factory_updated_at: string | null
  compiled_goal: FactoryGoal | null
  tool_call_budget: number
  tool_timeout_ms: number
  tool_retry_limit: number
  tool_calls_used: number
  summary: string
  result: AgentAnalysisResult | null
  error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  steps: AgentStep[]
  tool_calls: AgentToolCall[]
  events: AgentRunEvent[]
  patches: AgentPatch[]
}

export interface AgentRunEvent {
  id: string
  sequence: number
  event_name: string
  data: Record<string, unknown>
  created_at: string
}

export const agentRepository = {
  createRun(factoryId: string, objective: string, mode: AgentRunMode = 'read_only'): Promise<AgentRun> {
    return apiRequest<AgentRun>('/api/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ factory_id: factoryId, objective, mode }),
    })
  },

  analyzeRun(runId: string): Promise<AgentRun> {
    return apiRequest<AgentRun>(`/api/agent/runs/${encodeURIComponent(runId)}/analyze`, { method: 'POST' })
  },

  getRun(runId: string): Promise<AgentRun> {
    return apiRequest<AgentRun>(`/api/agent/runs/${encodeURIComponent(runId)}`)
  },

  listRuns(factoryId: string): Promise<AgentRun[]> {
    return apiRequest<AgentRun[]>(`/api/agent/runs?factory_id=${encodeURIComponent(factoryId)}`)
  },

  cancelRun(runId: string): Promise<AgentRun> {
    return apiRequest<AgentRun>(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
  },

  listPatches(runId: string): Promise<AgentPatch[]> {
    return apiRequest<AgentPatch[]>(`/api/agent/runs/${encodeURIComponent(runId)}/patches`)
  },

  getPatch(patchId: string): Promise<AgentPatch> {
    return apiRequest<AgentPatch>(`/api/agent/patches/${encodeURIComponent(patchId)}`)
  },

  approvePatch(patchId: string, note?: string): Promise<AgentPatch> {
    return apiRequest<AgentPatch>(`/api/agent/patches/${encodeURIComponent(patchId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note: note ?? null }),
    })
  },

  rejectPatch(patchId: string, note?: string): Promise<AgentPatch> {
    return apiRequest<AgentPatch>(`/api/agent/patches/${encodeURIComponent(patchId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note: note ?? null }),
    })
  },

  applyPatch(patchId: string): Promise<AgentPatch> {
    return apiRequest<AgentPatch>(`/api/agent/patches/${encodeURIComponent(patchId)}/apply`, { method: 'POST' })
  },

  rollbackPatch(patchId: string): Promise<AgentPatch> {
    return apiRequest<AgentPatch>(`/api/agent/patches/${encodeURIComponent(patchId)}/rollback`, { method: 'POST' })
  },
}
