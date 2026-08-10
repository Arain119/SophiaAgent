/**
 * Zod schemas for permission updates.
 *
 * This file is intentionally kept minimal with no complex dependencies
 * so it can be safely imported by src/types/hooks.ts without creating
 * circular dependencies.
 */
import z from 'zod/v4'
// Types extracted to src/types/safety.ts to break import cycles
import type {
  SafetyRuleUpdate,
  SafetyRuleUpdateDestination,
} from '../../types/safety.js'
import { lazySchema } from '../lazySchema.js'
import {
  safetyRuleBehaviorSchema,
  safetyRuleValueSchema,
} from './SafetyRule.js'

// Re-export for backwards compatibility
export type { SafetyRuleUpdate, SafetyRuleUpdateDestination }

/**
 * SafetyRuleUpdateDestination is where a new permission rule should be saved to.
 */
export const safetyRuleUpdateDestinationSchema = lazySchema(() =>
  z.enum([
    // User settings (global)
    'userSettings',
    // Project settings (shared per-directory)
    'projectSettings',
    // Local settings (gitignored)
    'localSettings',
    // In-memory for the current session only
    'session',
    // From the command line arguments
    'cliArg',
  ]),
)

export const safetyRuleUpdateSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('addRules'),
      rules: z.array(safetyRuleValueSchema()),
      behavior: safetyRuleBehaviorSchema(),
      destination: safetyRuleUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('replaceRules'),
      rules: z.array(safetyRuleValueSchema()),
      behavior: safetyRuleBehaviorSchema(),
      destination: safetyRuleUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeRules'),
      rules: z.array(safetyRuleValueSchema()),
      behavior: safetyRuleBehaviorSchema(),
      destination: safetyRuleUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: safetyRuleUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: safetyRuleUpdateDestinationSchema(),
    }),
  ]),
)
