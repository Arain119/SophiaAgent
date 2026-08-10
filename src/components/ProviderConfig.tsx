import { Box, Dialog, Text } from '@anthropic/ink';
import React, { useCallback, useMemo, useState } from 'react';
import {
  hasSavedProviderConfiguration,
  removeProviderConfiguration,
  saveProviderConfiguration,
  type ProviderField,
  type ProviderValues,
} from '../commands/provider/configuration.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { providerConfigurationDependencies } from '../commands/provider/runtime.js';

import { getSettingsForSource } from '../utils/settings/settings.js';
import { useSetAppState } from '../state/AppState.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Select } from './CustomSelect/select.js';
import TextInput from './TextInput.js';

type Props = {
  onDone(result: ProviderConfigResult): void;
};

export type ProviderConfigResult = 'saved' | 'cancelled';

type ProviderView = { kind: 'form'; existingName?: string } | { kind: 'remove'; name: string } | null;

const FIELDS: ProviderField[] = ['name', 'baseUrl', 'apiKey'];

const LABELS: Record<ProviderField, string> = {
  name: 'Name    ',
  baseUrl: 'Base URL',
  apiKey: 'API Key ',
};

function getInitialValues(existingName?: string): ProviderValues {
  const profile = existingName ? getSettingsForSource('userSettings')?.providers?.[existingName] : undefined;
  if (!profile) {
    return {
      name: '',
      baseUrl: '',
      apiKey: '',
    };
  }
  return {
    name: existingName ?? '',
    baseUrl: profile.baseUrl,
    apiKey: '',
  };
}

export function ProviderConfig({ onDone }: Props): React.ReactNode {
  const [view, setView] = useState<ProviderView>(null);
  const [error, setError] = useState<string | null>(null);
  const [didChange, setDidChange] = useState(false);
  const [, refresh] = useState(0);
  const setAppState = useSetAppState();
  const userSettings = getSettingsForSource('userSettings');
  const profiles = userSettings?.providers ?? {};
  const isConfigured = hasSavedProviderConfiguration(userSettings);

  const finish = useCallback(
    (result: ProviderConfigResult) => {
      if (result !== 'cancelled') {
        setAppState(previous => ({
          ...previous,
          mainLoopModel: null,
          mainLoopModelForSession: null,
        }));
      }
      onDone(result);
    },
    [onDone, setAppState],
  );

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

  const selectAction = useCallback(
    (value: string) => {
      setError(null);
      const separator = value.indexOf(':');
      const action = separator === -1 ? value : value.slice(0, separator);
      const name = separator === -1 ? '' : value.slice(separator + 1);

      if (action === 'done') {
        finish('saved');
        return;
      }
      if (action === 'add') {
        setView({
          kind: 'form',
        });
        return;
      }
      if (action === 'edit') {
        const profile = profiles[name];
        if (profile) {
          setView({
            kind: 'form',
            existingName: name,
          });
        }
        return;
      }
      if (action === 'remove') {
        setView({ kind: 'remove', name });
        return;
      }
    },
    [completeChange, finish, profiles],
  );

  return (
    <Dialog
      title="Provider"
      color={view?.kind === 'remove' ? 'error' : 'permission'}
      onCancel={() => (view ? setView(null) : finish(didChange ? 'saved' : 'cancelled'))}
    >
      {view?.kind === 'remove' ? (
        <ProviderRemovalConfirmation name={view.name} onBack={() => setView(null)} onRemoved={completeChange} />
      ) : view?.kind === 'form' ? (
        <ProviderForm
          key={view.existingName ?? 'new'}
          existingName={view.existingName}
          onBack={() => setView(null)}
          onSaved={completeChange}
        />
      ) : (
        <Box flexDirection="column" gap={1}>
          <Select
            options={[
              ...Object.keys(profiles).flatMap(name => [
                {
                  label: `Edit ${name}`,
                  value: `edit:${name}`,
                },
                {
                  label: `Remove ${name}`,
                  value: `remove:${name}`,
                },
              ]),
              { label: 'Add OpenAI Responses provider', value: 'add' },
              { label: 'Done', value: 'done' },
            ]}
            onChange={selectAction}
          />
          {!isConfigured ? <Text dimColor>Add a named provider to start.</Text> : null}
          {error ? <Text color="error">{error}</Text> : null}
        </Box>
      )}
    </Dialog>
  );
}

function ProviderRemovalConfirmation({
  name,
  onBack,
  onRemoved,
}: {
  name: string;
  onBack(): void;
  onRemoved(): void;
}): React.ReactNode {
  const [error, setError] = useState<string | null>(null);
  const confirmRemoval = useCallback(() => {
    const removeError = removeProviderConfiguration(name, providerConfigurationDependencies);
    if (removeError) {
      setError(removeError.message);
      return;
    }
    onRemoved();
  }, [name, onRemoved]);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Remove provider "{name}"?</Text>
      <Select
        options={[
          { label: 'Yes, remove', value: 'yes' },
          { label: 'No, cancel', value: 'no' },
        ]}
        onChange={value => (value === 'yes' ? confirmRemoval() : onBack())}
        onCancel={onBack}
      />
      {error ? <Text color="error">{error}</Text> : null}
    </Box>
  );
}

function ProviderForm({
  existingName,
  onBack,
  onSaved,
}: {
  existingName?: string;
  onBack(): void;
  onSaved(): void;
}): React.ReactNode {
  const [values, setValues] = useState<ProviderValues>(() => getInitialValues(existingName));
  const [activeField, setActiveField] = useState<ProviderField>('name');
  const [inputValue, setInputValue] = useState(values.name);
  const [cursorOffset, setCursorOffset] = useState(values.name.length);
  const [error, setError] = useState<string | null>(null);
  const columns = Math.max(20, useTerminalSize().columns - 20);

  const committedValues = useMemo(() => ({ ...values, [activeField]: inputValue }), [activeField, inputValue, values]);

  const switchField = useCallback(
    (field: ProviderField) => {
      const nextValues = { ...values, [activeField]: inputValue };
      setValues(nextValues);
      setActiveField(field);
      setInputValue(nextValues[field]);
      setCursorOffset(nextValues[field].length);
      setError(null);
    },
    [activeField, inputValue, values],
  );

  const submit = useCallback(() => {
    const index = FIELDS.indexOf(activeField);
    if (index < FIELDS.length - 1) {
      switchField(FIELDS[index + 1]!);
      return;
    }
    const saveError = saveProviderConfiguration(committedValues, providerConfigurationDependencies, existingName);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved();
  }, [activeField, committedValues, existingName, onSaved, switchField]);

  useKeybinding(
    'tabs:next',
    () => {
      const index = FIELDS.indexOf(activeField);
      switchField(FIELDS[(index + 1) % FIELDS.length]!);
    },
    { context: 'FormField' },
  );
  useKeybinding(
    'tabs:previous',
    () => {
      const index = FIELDS.indexOf(activeField);
      switchField(FIELDS[(index - 1 + FIELDS.length) % FIELDS.length]!);
    },
    { context: 'FormField' },
  );
  useKeybinding('confirm:no', onBack, { context: 'Confirmation' });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>OpenAI Responses</Text>
      <Box flexDirection="column">
        {FIELDS.map(field => {
          const active = activeField === field;
          const value = committedValues[field];
          return (
            <Box key={field}>
              <Text backgroundColor={active ? 'suggestion' : undefined} color={active ? 'inverseText' : undefined}>
                {` ${LABELS[field]} `}
              </Text>
              <Text> </Text>
              {active ? (
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={submit}
                  cursorOffset={cursorOffset}
                  onChangeCursorOffset={setCursorOffset}
                  columns={columns}
                  mask={field === 'apiKey' ? '*' : undefined}
                  focus
                />
              ) : (
                <Text color={value ? 'success' : undefined}>
                  {field === 'apiKey' && value
                    ? `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 4))}`
                    : value}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      {error ? <Text color="error">{error}</Text> : null}
      {existingName ? <Text dimColor>Leave API Key blank to keep the stored credential.</Text> : null}
    </Box>
  );
}
