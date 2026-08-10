const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export const EXIT_PLAN_MODE_V2_TOOL_PROMPT = `Use this tool when you are in plan mode, have finished writing the plan file, and are ready to implement it.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool finishes the internal planning workflow and returns Sophia Agent to auto execution
- Continue implementing the plan after the tool succeeds

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use ${ASK_USER_QUESTION_TOOL_NAME} first (in earlier phases)
- Once your plan is finalized, use THIS tool and proceed with implementation
- Do not ask the user to approve the plan unless a genuine product decision is still unresolved
`
