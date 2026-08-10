import { getDisplayedEffortLevel } from '../utils/effort.js'
import { getMainLoopModel } from '../utils/model/model.js'

export type PromptRuntime = {
  model: string
  effort: string
  cwd: string
}

/** Runtime values substituted into automatic maintenance prompts. */
export function getPromptRuntime(): PromptRuntime {
  const model = getMainLoopModel()
  return {
    model,
    effort: getDisplayedEffortLevel(model, undefined),
    cwd: process.cwd(),
  }
}
