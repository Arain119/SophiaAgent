/** JSON input passed to a user-configured status line command. */
export type StatusLineCommandInput = {
  session_id: string
  transcript_path: string
  cwd: string
  agent_id?: string
  agent_type?: string
  session_name?: string
  model: {
    id: string
    display_name: string
  }
  workspace: {
    current_dir: string
    project_dir: string
    added_dirs: string[]
  }
  version: string
  output_style: {
    name: string
  }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    total_input_tokens: number | null
    total_output_tokens: number | null
    context_window_size: number
    current_usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    } | null
    used_percentage: number | null
    remaining_percentage: number | null
  }
  exceeds_200k_tokens: boolean
  vim?: {
    mode: string
  }
  agent?: {
    name: string
  }
  remote?: {
    session_id: string
  }
  worktree?: {
    name: string
    path: string
    branch?: string
    original_cwd: string
    original_branch?: string
  }
}
