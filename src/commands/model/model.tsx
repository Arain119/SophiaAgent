import type { ReactNode } from 'react';
import { ModelConfig } from '../../components/ModelConfig.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { stripSignatureBlocks } from '../../utils/messages.js';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<ReactNode> {
  return (
    <ModelConfig
      onDone={result => {
        if (result === 'saved') {
          context.onChangeAPIKey();
          context.setMessages(stripSignatureBlocks);
        }
        onDone(result === 'saved' ? 'Model configuration updated' : 'Model configuration cancelled');
      }}
    />
  );
}
