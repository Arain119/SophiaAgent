# External Dependencies

Sophia Agent uses external services only when the selected capability needs
them. Model inference is sent through the OpenAI Responses protocol configured
in `/model`.

## Runtime services

- Provider endpoint: the configured Responses Base URL and API key
- Web tools: the configured search or fetch service when used
- Skills: public Skill discovery and download only after the model decides a
  local Skill is insufficient
- MCP: the official MCP Registry and the selected server transport when a task
  requires an unavailable integration
- Browser: Sophia's integrated Chromium runtime
- SSH: the user's configured host, key, or password

Install and build do not contact these services or modify machine settings.
