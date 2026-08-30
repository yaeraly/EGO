import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { NotificationList } from '../api/types';

/**
 * The unread badge in the navigation.
 *
 * Polled rather than pushed: the alerts are a once-a-day digest (§39), so a
 * minute of staleness costs nothing and a socket would be machinery with no
 * purpose.
 */
export function useUnreadCount(intervalMs = 60_000): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      api<NotificationList>('/notifications?unread=true&limit=1')
        .then((result) => {
          if (!cancelled) setCount(result.unread_count);
        })
        .catch(() => {
          // A failed poll is not worth interrupting the screen for.
        });
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return count;
}
