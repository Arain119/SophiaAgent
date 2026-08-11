import React from 'react';

export function SubAgentProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}

export function CtrlOToExpand(): React.ReactNode {
  return null;
}

export function ctrlOToExpand(): string {
  return '';
}
