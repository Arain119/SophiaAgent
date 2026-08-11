import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext } from 'react';
import { ERROR_MESSAGE_USER_ABORT } from 'src/services/compact/compact.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, NoSelect, Text } from '@anthropic/ink';
import {
  API_ERROR_MESSAGE_PREFIX,
  API_TIMEOUT_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  startsWithApiErrorPrefix,
} from '../../services/api/errors.js';
import { isEmptyMessageText, NO_RESPONSE_REQUESTED } from '../../utils/messages.js';
import { isMacOsKeychainLocked } from '../../utils/secureStorage/macOsKeychainStorage.js';
import { InterruptedByUser } from '../InterruptedByUser.js';
import { Markdown } from '../Markdown.js';
import { MessageResponse } from '../MessageResponse.js';
import { MessageActionsSelectedContext } from '../messageActions.js';

const MAX_API_ERROR_CHARS = 1000;

type Props = {
  param: TextBlockParam;
  addMargin: boolean;
  shouldShowDot: boolean;
  verbose: boolean;
  width?: number | string;
};

function InvalidApiKeyMessage(): React.ReactNode {
  const isKeychainLocked = isMacOsKeychainLocked();
  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{INVALID_API_KEY_ERROR_MESSAGE}</Text>
        {isKeychainLocked && <Text dimColor>Run in another terminal: security unlock-keychain</Text>}
      </Box>
    </MessageResponse>
  );
}

export function AssistantTextMessage({ param: { text }, addMargin, shouldShowDot, verbose }: Props): React.ReactNode {
  const isSelected = useContext(MessageActionsSelectedContext);
  if (isEmptyMessageText(text)) return null;

  switch (text) {
    case NO_RESPONSE_REQUESTED:
      return null;
    case PROMPT_TOO_LONG_ERROR_MESSAGE:
      return (
        <MessageResponse height={1}>
          <Text color="error">Context limit reached. Start a new session with /new to continue.</Text>
        </MessageResponse>
      );
    case INVALID_API_KEY_ERROR_MESSAGE:
      return <InvalidApiKeyMessage />;
    case INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL:
      return (
        <MessageResponse height={1}>
          <Text color="error">{INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL}</Text>
        </MessageResponse>
      );
    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY:
      return (
        <MessageResponse>
          <Text color="error">{text}</Text>
        </MessageResponse>
      );
    case API_TIMEOUT_ERROR_MESSAGE:
      return (
        <MessageResponse height={1}>
          <Text color="error">
            {API_TIMEOUT_ERROR_MESSAGE}
            {process.env.API_TIMEOUT_MS && <> (API_TIMEOUT_MS={process.env.API_TIMEOUT_MS}ms, try increasing it)</>}
          </Text>
        </MessageResponse>
      );
    case ERROR_MESSAGE_USER_ABORT:
      return (
        <MessageResponse height={1}>
          <InterruptedByUser />
        </MessageResponse>
      );
    default:
      if (startsWithApiErrorPrefix(text)) {
        const truncated = !verbose && text.length > MAX_API_ERROR_CHARS;
        return (
          <MessageResponse>
            <Box flexDirection="column">
              <Text color="error">
                {text === API_ERROR_MESSAGE_PREFIX
                  ? `${API_ERROR_MESSAGE_PREFIX}: Please wait a moment and try again.`
                  : truncated
                    ? `${text.slice(0, MAX_API_ERROR_CHARS)}...`
                    : text}
              </Text>
            </Box>
          </MessageResponse>
        );
      }
      return (
        <Box
          alignItems="flex-start"
          flexDirection="row"
          justifyContent="space-between"
          marginTop={addMargin ? 1 : 0}
          width="100%"
          backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
        >
          <Box flexDirection="row">
            {shouldShowDot && (
              <NoSelect fromLeftEdge minWidth={2}>
                <Text color={isSelected ? 'suggestion' : 'text'}>{BLACK_CIRCLE}</Text>
              </NoSelect>
            )}
            <Box flexDirection="column">
              <Markdown>{text}</Markdown>
            </Box>
          </Box>
        </Box>
      );
  }
}
