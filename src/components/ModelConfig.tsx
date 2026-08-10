import { Box, Dialog, Text } from '@anthropic/ink';
import React, { useCallback, useState } from 'react';
import { saveModelConfiguration } from '../commands/model/configuration.js';
import { modelConfigurationDependencies } from '../commands/model/runtime.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useSetAppState } from '../state/AppState.js';
import type { AgentModelRole } from '../utils/providerProfiles.js';
import { getSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/select.js';
import TextInput from './TextInput.js';
import { ProviderConfig } from './ProviderConfig.js';

type Props = {
  onDone(result: 'saved' | 'cancelled'): void;
};

export function ModelConfig({ onDone }: Props): React.ReactNode {
  const [view, setView] = useState<AgentModelRole | 'providers' | null>(null);
  const [didChange, setDidChange] = useState(false);
  const [, refresh] = useState(0);
  const setAppState = useSetAppState();
  const settings = getSettingsForSource('userSettings');
  const routes = settings?.agentModels;
  const hasProviders = Object.keys(settings?.providers ?? {}).length > 0;

  const completeChange = useCallback(() => {
    setAppState(previous => ({
      ...previous,
      mainLoopModel: null,
      mainLoopModelForSession: null,
    }));
    setDidChange(true);
    setView(null);
    refresh(value => value + 1);
  }, [setAppState]);

  if (view === 'providers') {
    return <ProviderConfig onDone={result => (result === 'saved' ? completeChange() : setView(null))} />;
  }

  if (view === 'main' || view === 'subagent') {
    return <ModelForm role={view} onBack={() => setView(null)} onSaved={completeChange} />;
  }

  if (!hasProviders) {
    return (
      <Dialog title="Model" color="permission" onCancel={() => onDone('cancelled')}>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Add a provider before configuring model routes.</Text>
          <Select
            options={[
              { label: 'Add provider', value: 'providers' },
              { label: 'Done', value: 'done' },
            ]}
            onChange={value => (value === 'providers' ? setView('providers') : onDone('cancelled'))}
          />
        </Box>
      </Dialog>
    );
  }

  return (
    <Dialog title="Model" color="permission" onCancel={() => onDone(didChange ? 'saved' : 'cancelled')}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            Main agent <Text color="success">{routes?.main.model ?? 'Not configured'}</Text>
            {routes ? <Text dimColor> via {routes.main.provider}</Text> : null}
          </Text>
          <Text>
            Subagents <Text color="success">{routes?.subagent.model ?? 'Not configured'}</Text>
            {routes ? <Text dimColor> via {routes.subagent.provider}</Text> : null}
          </Text>
        </Box>
        <Select
          options={[
            { label: 'Edit main agent', value: 'main' },
            { label: 'Edit subagents', value: 'subagent' },
            { label: 'Manage providers', value: 'providers' },
            { label: 'Done', value: 'done' },
          ]}
          onChange={value => {
            if (value === 'done') onDone(didChange ? 'saved' : 'cancelled');
            else setView(value as AgentModelRole | 'providers');
          }}
        />
      </Box>
    </Dialog>
  );
}

function ModelForm({
  role,
  onBack,
  onSaved,
}: {
  role: AgentModelRole;
  onBack(): void;
  onSaved(): void;
}): React.ReactNode {
  const settings = getSettingsForSource('userSettings');
  const providers = Object.keys(settings?.providers ?? {});
  const current = settings?.agentModels?.[role];
  const [provider, setProvider] = useState(current?.provider ?? providers[0] ?? '');
  const [model, setModel] = useState(current?.model ?? '');
  const [editingModel, setEditingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorOffset, setCursorOffset] = useState(model.length);
  const columns = Math.max(20, useTerminalSize().columns - 20);

  const submit = useCallback(() => {
    const saveError = saveModelConfiguration(role, { model, provider }, modelConfigurationDependencies);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved();
  }, [model, onSaved, provider, role]);

  return (
    <Dialog title={role === 'main' ? 'Main agent model' : 'Subagent model'} color="permission" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        <Text>Provider</Text>
        {editingModel ? (
          <Text color="success">{provider}</Text>
        ) : (
          <Select
            options={providers.map(name => ({ label: name, value: name }))}
            defaultValue={provider}
            onChange={value => {
              setProvider(value);
              setEditingModel(true);
              setError(null);
            }}
            onCancel={onBack}
          />
        )}
        {editingModel ? (
          <Box flexDirection="column">
            <Text>Model ID</Text>
            <TextInput
              value={model}
              onChange={setModel}
              onSubmit={submit}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              columns={columns}
              focus
            />
          </Box>
        ) : null}
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    </Dialog>
  );
}
