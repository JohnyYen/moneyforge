import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

export type QueryState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T };

/** Loads when the screen gains focus, so it reflects what other screens just wrote. */
export function useFocusQuery<T>(load: () => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load().then(
        (data) => {
          if (active) setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (active) setState({ status: 'error', message: messageOf(error) });
        },
      );
      return () => {
        active = false;
      };
      // `attempt` re-runs the load on demand.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, attempt]),
  );

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, reload };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
