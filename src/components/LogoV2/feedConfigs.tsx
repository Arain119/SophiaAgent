import type { LogOption } from '../../types/logs.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import type { FeedConfig, FeedLine } from './Feed.js';

export const RECENT_ACTIVITY_TITLE_COLOR = 'sophiaBlue' as const;

export function createRecentActivityFeed(activities: LogOption[]): FeedConfig {
  const lines: FeedLine[] = activities.map(log => ({
    text: (log.summary && log.summary !== 'No prompt' ? log.summary : log.firstPrompt) || '',
    timestamp: formatRelativeTimeAgo(log.modified),
  }));

  return {
    title: 'Recent activity',
    titleColor: RECENT_ACTIVITY_TITLE_COLOR,
    lines,
    footer: lines.length > 0 ? '/resume for more' : undefined,
    emptyMessage: 'No recent activity',
  };
}
