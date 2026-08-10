// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .sophia/ folder
export const SOPHIA_FOLDER_PERMISSION_PATTERN = '/.sophia/**'

// Permission pattern for granting session-level access to the global ~/.sophia/ folder
export const GLOBAL_SOPHIA_FOLDER_PERMISSION_PATTERN = '~/.sophia/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
