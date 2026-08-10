import { Text } from '@anthropic/ink';
import { useEffect } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';

type Props = {
  mcpClients?: MCPServerConnection[];
};

const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

export function useMcpConnectivityStatus({ mcpClients = EMPTY_MCP_CLIENTS }: Props): void {
  const { addNotification } = useNotifications();
  useEffect(() => {
    if (getIsRemoteMode()) return;
    const failedClients = mcpClients.filter(
      client => client.type === 'failed' && client.config.type !== 'sse-ide' && client.config.type !== 'ws-ide',
    );
    const needsAuthClients = mcpClients.filter(client => client.type === 'needs-auth');

    if (failedClients.length > 0) {
      addNotification({
        key: 'mcp-failed',
        jsx: (
          <Text color="error">
            {failedClients.length} MCP {failedClients.length === 1 ? 'server' : 'servers'} failed
          </Text>
        ),
        priority: 'medium',
      });
    }
    if (needsAuthClients.length > 0) {
      addNotification({
        key: 'mcp-needs-auth',
        jsx: (
          <Text color="warning">
            {needsAuthClients.length} MCP{' '}
            {needsAuthClients.length === 1 ? 'server needs credentials' : 'servers need credentials'}
          </Text>
        ),
        priority: 'medium',
      });
    }
  }, [addNotification, mcpClients]);
}
