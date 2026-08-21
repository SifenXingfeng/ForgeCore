import { useForgeMindStore } from '../store/forgeMind'
import {
  createFactoryAssistantContext,
  validateAssistantToolCall,
  type AssistantToolCall,
  type FactoryAssistantContext,
} from './assistantProtocol'

export type AssistantExecutionResult =
  | { status: 'rejected'; answer: string }
  | { status: 'awaiting_confirmation'; answer: string; call: AssistantToolCall; summary: string }
  | { status: 'executed'; answer: string; data?: unknown }

export function getCurrentFactoryAssistantContext(): FactoryAssistantContext {
  const state = useForgeMindStore.getState()
  return createFactoryAssistantContext({
    objects: state.objects,
    items: state.items,
    recipes: state.recipes,
    snapshot: state.simSnapshot,
    running: state.simPlaying,
    speed: state.simSpeed,
  })
}

export function executeAssistantToolCall(raw: unknown, options: { confirmed?: boolean } = {}): AssistantExecutionResult {
  const context = getCurrentFactoryAssistantContext()
  const validation = validateAssistantToolCall(raw, context)
  if (!validation.ok) return { status: 'rejected', answer: validation.message }
  if (validation.requiresConfirmation && !options.confirmed) {
    return {
      status: 'awaiting_confirmation',
      answer: `该操作需要确认：${validation.summary}。`,
      call: validation.call,
      summary: validation.summary,
    }
  }

  const state = useForgeMindStore.getState()
  const call = validation.call
  switch (call.name) {
    case 'query_factory_status':
      return { status: 'executed', answer: factoryStatusAnswer(context), data: context.simulation }
    case 'inspect_object': {
      const object = context.objects.find((candidate) => candidate.id === call.arguments.objectId)!
      return { status: 'executed', answer: `${object.label}状态已读取。`, data: object }
    }
    case 'select_object':
      state.select(call.arguments.objectId)
      return { status: 'executed', answer: '目标设备已定位。' }
    case 'set_simulation_running':
      state.setSimPlaying(call.arguments.running)
      return { status: 'executed', answer: call.arguments.running ? '工厂仿真已启动。' : '工厂仿真已暂停。' }
    case 'set_simulation_speed':
      state.setSimSpeed(call.arguments.speed)
      return { status: 'executed', answer: `仿真倍率已设为 ${call.arguments.speed}。` }
    case 'reset_simulation':
      state.requestSimReset()
      return { status: 'executed', answer: '仿真运行进度已重置。' }
    case 'change_machine_recipe':
      state.bindRecipe(call.arguments.objectId, call.arguments.recipeId)
      return { status: 'executed', answer: '设备配方已更新。' }
    case 'bind_source_item':
      state.bindItem(call.arguments.objectId, call.arguments.itemId)
      return { status: 'executed', answer: '来料站物品已更新。' }
  }
}

function factoryStatusAnswer(context: FactoryAssistantContext): string {
  const produced = Object.values(context.simulation.produced).reduce((sum, quantity) => sum + quantity, 0)
  const state = context.simulation.running ? '运行中' : '已暂停'
  return `工厂${state}，在途物料 ${context.simulation.inTransit} 件，累计产出 ${produced} 件。`
}
