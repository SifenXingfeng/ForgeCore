import toolCatalogJson from '../../contracts/forgemind-assistant-tools.json'
import { getObjectDef, objectRole, type BuildType, type FactoryObject, type GridPos, type Rotation } from './types'
import type { Item, Recipe } from './item'
import type { SimulationSnapshot } from './simulation'

export const ASSISTANT_PROTOCOL_VERSION = '1.0.0' as const

export const ASSISTANT_TOOL_NAMES = [
  'query_factory_status',
  'inspect_object',
  'select_object',
  'set_simulation_running',
  'set_simulation_speed',
  'reset_simulation',
  'change_machine_recipe',
  'bind_source_item',
] as const

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number]
export type AssistantRisk = 'read_only' | 'reversible' | 'configuration_change' | 'destructive_runtime'

export interface AssistantToolDefinition {
  name: AssistantToolName
  description: string
  risk: AssistantRisk
  requiresConfirmation: boolean
  parameters: Record<string, unknown>
}

export interface AssistantToolCatalog {
  protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION
  assistant: string
  tools: AssistantToolDefinition[]
}

export type AssistantToolCall =
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'query_factory_status'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'inspect_object'; arguments: { objectId: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'select_object'; arguments: { objectId: string } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'set_simulation_running'; arguments: { running: boolean } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'set_simulation_speed'; arguments: { speed: number } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'reset_simulation'; arguments: Record<string, never> }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'change_machine_recipe'; arguments: { objectId: string; recipeId: string | null } }
  | { protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION; name: 'bind_source_item'; arguments: { objectId: string; itemId: string | null } }

export interface FactoryAssistantObject {
  id: string
  type: BuildType
  label: string
  role: ReturnType<typeof objectRole>
  pos: GridPos
  rotation: Rotation
  recipeId: string | null
  itemId: string | null
  runtime: Record<string, unknown> | null
}

export interface FactoryAssistantContext {
  protocolVersion: typeof ASSISTANT_PROTOCOL_VERSION
  generatedAt: string
  simulation: {
    running: boolean
    speed: number
    timeSec: number
    inTransit: number
    consumed: Record<string, number>
    produced: Record<string, number>
  }
  objects: FactoryAssistantObject[]
  items: Array<Pick<Item, 'id' | 'name' | 'category'>>
  recipes: Array<Pick<Recipe, 'id' | 'name' | 'inputs' | 'outputs' | 'durationSec'>>
}

export type AssistantValidationCode =
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'OBJECT_NOT_FOUND'
  | 'WRONG_OBJECT_ROLE'
  | 'RECIPE_NOT_FOUND'
  | 'ITEM_NOT_FOUND'

export type AssistantValidationResult =
  | {
      ok: true
      call: AssistantToolCall
      risk: AssistantRisk
      requiresConfirmation: boolean
      summary: string
    }
  | {
      ok: false
      code: AssistantValidationCode
      message: string
    }

const toolNames = new Set<string>(ASSISTANT_TOOL_NAMES)
const toolDefinitions = new Map<string, AssistantToolDefinition>()

export const ASSISTANT_TOOL_CATALOG = toolCatalogJson as AssistantToolCatalog

if (ASSISTANT_TOOL_CATALOG.protocolVersion !== ASSISTANT_PROTOCOL_VERSION) {
  throw new Error(`智能管家协议版本不一致：${ASSISTANT_TOOL_CATALOG.protocolVersion}`)
}
for (const definition of ASSISTANT_TOOL_CATALOG.tools) toolDefinitions.set(definition.name, definition)
for (const name of ASSISTANT_TOOL_NAMES) {
  if (!toolDefinitions.has(name)) throw new Error(`智能管家工具目录缺少 ${name}`)
}

export function createFactoryAssistantContext(input: {
  objects: FactoryObject[]
  items: Item[]
  recipes: Recipe[]
  snapshot: SimulationSnapshot
  running: boolean
  speed: number
  generatedAt?: string
}): FactoryAssistantContext {
  const machineRuntime = new Map(input.snapshot.machines.map((runtime) => [runtime.objectId, runtime]))
  const sourceRuntime = new Map(input.snapshot.sources.map((runtime) => [runtime.objectId, runtime]))

  return {
    protocolVersion: ASSISTANT_PROTOCOL_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    simulation: {
      running: input.running,
      speed: input.speed,
      timeSec: input.snapshot.timeSec,
      inTransit: input.snapshot.itemLots.length,
      consumed: { ...input.snapshot.stats.consumed },
      produced: { ...input.snapshot.stats.produced },
    },
    objects: input.objects.map((object) => ({
      id: object.id,
      type: object.type,
      label: getObjectDef(object.type, object.resourceId).label,
      role: objectRole(object.type, object.resourceId),
      pos: { ...object.pos },
      rotation: object.rotation,
      recipeId: object.recipeId ?? null,
      itemId: object.itemId ?? null,
      runtime: toRuntimeRecord(machineRuntime.get(object.id) ?? sourceRuntime.get(object.id)),
    })),
    items: input.items.map(({ id, name, category }) => ({ id, name, category })),
    recipes: input.recipes.map(({ id, name, inputs, outputs, durationSec }) => ({
      id,
      name,
      inputs: inputs.map((port) => ({ ...port })),
      outputs: outputs.map((port) => ({ ...port })),
      durationSec,
    })),
  }
}

export function validateAssistantToolCall(raw: unknown, context: FactoryAssistantContext): AssistantValidationResult {
  if (!isPlainRecord(raw)) return failure('INVALID_ENVELOPE', '工具调用必须是 JSON 对象。')
  if (raw.protocolVersion !== ASSISTANT_PROTOCOL_VERSION) {
    return failure('UNSUPPORTED_VERSION', `仅支持协议 ${ASSISTANT_PROTOCOL_VERSION}。`)
  }
  if (typeof raw.name !== 'string' || !toolNames.has(raw.name)) {
    return failure('UNKNOWN_TOOL', '请求的工具不在 ForgeMind 动作白名单中。')
  }
  if (!isPlainRecord(raw.arguments)) return failure('INVALID_ARGUMENTS', 'arguments 必须是 JSON 对象。')

  const name = raw.name as AssistantToolName
  const args = raw.arguments
  const definition = toolDefinitions.get(name)!
  const valid = validateArguments(name, args, context)
  if (!valid.ok) return valid

  const call = { protocolVersion: ASSISTANT_PROTOCOL_VERSION, name, arguments: args } as AssistantToolCall
  return {
    ok: true,
    call,
    risk: definition.risk,
    requiresConfirmation: definition.requiresConfirmation,
    summary: summarizeCall(call, context),
  }
}

function validateArguments(
  name: AssistantToolName,
  args: Record<string, unknown>,
  context: FactoryAssistantContext,
): { ok: true } | Extract<AssistantValidationResult, { ok: false }> {
  const allowedKeys: Record<AssistantToolName, string[]> = {
    query_factory_status: [],
    inspect_object: ['objectId'],
    select_object: ['objectId'],
    set_simulation_running: ['running'],
    set_simulation_speed: ['speed'],
    reset_simulation: [],
    change_machine_recipe: ['objectId', 'recipeId'],
    bind_source_item: ['objectId', 'itemId'],
  }
  if (!hasExactKeys(args, allowedKeys[name])) {
    return failure('INVALID_ARGUMENTS', `${name} 的参数字段不完整或包含未知字段。`)
  }

  if (name === 'query_factory_status' || name === 'reset_simulation') return { ok: true }
  if (name === 'set_simulation_running') {
    return typeof args.running === 'boolean'
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', 'running 必须是布尔值。')
  }
  if (name === 'set_simulation_speed') {
    return typeof args.speed === 'number' && Number.isFinite(args.speed) && args.speed >= 0.1 && args.speed <= 4
      ? { ok: true }
      : failure('INVALID_ARGUMENTS', 'speed 必须是 0.1 到 4 之间的有限数字。')
  }

  if (typeof args.objectId !== 'string' || args.objectId.length === 0) {
    return failure('INVALID_ARGUMENTS', 'objectId 必须是非空字符串。')
  }
  const object = context.objects.find((candidate) => candidate.id === args.objectId)
  if (!object) return failure('OBJECT_NOT_FOUND', `找不到对象 ${args.objectId}。`)
  if (name === 'inspect_object' || name === 'select_object') return { ok: true }

  if (name === 'change_machine_recipe') {
    if (object.role !== 'machine') return failure('WRONG_OBJECT_ROLE', `${object.label} 不是可绑定配方的加工设备。`)
    if (args.recipeId !== null && typeof args.recipeId !== 'string') {
      return failure('INVALID_ARGUMENTS', 'recipeId 必须是字符串或 null。')
    }
    if (typeof args.recipeId === 'string' && !context.recipes.some((recipe) => recipe.id === args.recipeId)) {
      return failure('RECIPE_NOT_FOUND', `找不到配方 ${args.recipeId}。`)
    }
    return { ok: true }
  }

  if (object.role !== 'source') return failure('WRONG_OBJECT_ROLE', `${object.label} 不是来料站。`)
  if (args.itemId !== null && typeof args.itemId !== 'string') {
    return failure('INVALID_ARGUMENTS', 'itemId 必须是字符串或 null。')
  }
  if (typeof args.itemId === 'string' && !context.items.some((item) => item.id === args.itemId)) {
    return failure('ITEM_NOT_FOUND', `找不到物品 ${args.itemId}。`)
  }
  return { ok: true }
}

function summarizeCall(call: AssistantToolCall, context: FactoryAssistantContext): string {
  switch (call.name) {
    case 'query_factory_status': return '读取当前工厂运行状态'
    case 'inspect_object': return `读取 ${objectLabel(context, call.arguments.objectId)} 的状态`
    case 'select_object': return `在界面中定位 ${objectLabel(context, call.arguments.objectId)}`
    case 'set_simulation_running': return call.arguments.running ? '启动工厂仿真' : '暂停工厂仿真'
    case 'set_simulation_speed': return `将全局仿真倍率设为 ×${call.arguments.speed}`
    case 'reset_simulation': return '重置仿真时间、在途物料和设备运行进度'
    case 'change_machine_recipe': {
      const recipe = context.recipes.find((candidate) => candidate.id === call.arguments.recipeId)
      return `将 ${objectLabel(context, call.arguments.objectId)} 的配方设为 ${recipe?.name ?? '未绑定'}`
    }
    case 'bind_source_item': {
      const item = context.items.find((candidate) => candidate.id === call.arguments.itemId)
      return `将 ${objectLabel(context, call.arguments.objectId)} 的来料设为 ${item?.name ?? '未绑定'}`
    }
  }
}

function objectLabel(context: FactoryAssistantContext, objectId: string): string {
  const object = context.objects.find((candidate) => candidate.id === objectId)
  return object ? `${object.label}（${object.id}）` : objectId
}

function toRuntimeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return { ...(value as unknown as Record<string, unknown>) }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function failure(code: AssistantValidationCode, message: string): Extract<AssistantValidationResult, { ok: false }> {
  return { ok: false, code, message }
}
