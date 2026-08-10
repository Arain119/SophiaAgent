export function getPrompt(): string {
  return `Use this tool proactively when a non-trivial task could benefit from specialized domain instructions, a repeatable workflow, or expert guidance needed to improve the result. For example, use it when a frontend works but its visual quality needs stronger design expertise.

Describe the task, not a skill name. Sophia automatically chooses the strongest relevant installed skill. When no strong local match exists, it searches the public Skills.sh catalog, accepts only audited GitHub skills, pins the selected repository commit, and downloads it with strict file and size limits.

Do not use this tool for trivial edits or when a skill is already active in the current turn. If no suitable skill exists, continue normally.`
}
