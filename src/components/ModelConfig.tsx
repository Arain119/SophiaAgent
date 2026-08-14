import { Box, Dialog, Text } from '@anthropic/ink';
import React, { useCallback, useState } from 'react';
import { saveModelConfiguration } from '../commands/model/configuration.js';
import { modelConfigurationDependencies } from '../commands/model/runtime.js';
import { useSetAppState } from '../state/AppState.js';
import {
  getModelForService,
  getModelService,
  type AgentModelRole,
  type ModelService,
} from '../utils/providerProfiles.js';
import { getSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/select.js';
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
            Mainagent <Text color="success">{routes?.main.model ?? 'Not configured'}</Text>
            {routes ? <Text dimColor> via {routes.main.provider}</Text> : null}
          </Text>
          <Text>
            Subagents <Text color="success">{routes?.subagent.model ?? 'Not configured'}</Text>
            {routes ? <Text dimColor> via {routes.subagent.provider}</Text> : null}
          </Text>
        </Box>
        <Select
          options={[
            { label: 'Edit Mainagent', value: 'main' },
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
  const [step, setStep] = useState<'provider' | 'service'>('provider');
  const [error, setError] = useState<string | null>(null);
  const currentService = getModelService(current?.model ?? '') ?? 'chatgpt';

  const save = useCallback(
    (service: ModelService) => {
      const saveError = saveModelConfiguration(
        role,
        { model: getModelForService(service, role), provider },
        modelConfigurationDependencies,
      );
      if (saveError) {
        setError(saveError.message);
        return;
      }
      onSaved();
    },
    [onSaved, provider, role],
  );

  return (
    <Dialog title={role === 'main' ? 'Mainagent model' : 'Subagents model'} color="permission" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        {step === 'provider' ? (
          <>
            <Text>Provider</Text>
            <Select
              options={providers.map(name => ({ label: name, value: name }))}
              defaultValue={providers.includes(provider) ? provider : providers[0]}
              onChange={value => {
                setProvider(value);
                setStep('service');
                setError(null);
              }}
              onCancel={onBack}
            />
          </>
        ) : (
          <>
            <Text>Model</Text>
            <Select
              options={[
                {
                  label: role === 'main' ? 'ChatGPT  gpt-5.6-sol' : 'ChatGPT  gpt-5.6-luna',
                  value: 'chatgpt' as const,
                },
                {
                  label: role === 'main' ? 'DeepSeek  deepseek-v4-pro' : 'DeepSeek  deepseek-v4-flash',
                  value: 'deepseek' as const,
                },
              ]}
              defaultValue={currentService}
              onChange={save}
              onCancel={() => setStep('provider')}
            />
          </>
        )}
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    </Dialog>
  );
}
