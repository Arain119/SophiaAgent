import figures from 'figures';
import * as React from 'react';
import { useContext } from 'react';
import { Text } from '@anthropic/ink';
import { findThinkingTriggerPositions, getRainbowColor, isUltrathinkEnabled } from '../../utils/thinking.js';
import { MessageActionsSelectedContext } from '../messageActions.js';

type Props = {
  text: string;
};

export function HighlightedThinkingText({ text }: Props): React.ReactNode {
  const isSelected = useContext(MessageActionsSelectedContext);
  const pointerColor = isSelected ? 'suggestion' : 'subtle';
  const triggers = isUltrathinkEnabled() ? findThinkingTriggerPositions(text) : [];

  if (triggers.length === 0) {
    return (
      <Text>
        <Text color={pointerColor}>{figures.pointer} </Text>
        <Text color="text">{text}</Text>
      </Text>
    );
  }

  // Static rainbow (no shimmer — transcript messages don't animate)
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const t of triggers) {
    if (t.start > cursor) {
      parts.push(
        <Text key={`plain-${cursor}`} color="text">
          {text.slice(cursor, t.start)}
        </Text>,
      );
    }
    for (let i = t.start; i < t.end; i++) {
      parts.push(
        <Text key={`rb-${i}`} color={getRainbowColor(i - t.start)}>
          {text[i]}
        </Text>,
      );
    }
    cursor = t.end;
  }
  if (cursor < text.length) {
    parts.push(
      <Text key={`plain-${cursor}`} color="text">
        {text.slice(cursor)}
      </Text>,
    );
  }

  return (
    <Text>
      <Text color={pointerColor}>{figures.pointer} </Text>
      {parts}
    </Text>
  );
}
