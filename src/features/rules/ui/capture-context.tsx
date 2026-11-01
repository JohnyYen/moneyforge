import { createContext, useContext } from 'react';

import type { MessageCapture } from '../application/message-capture';

export const CaptureContext = createContext<MessageCapture | null>(null);

export function useCapture(): MessageCapture {
  const capture = useContext(CaptureContext);
  if (!capture) throw new Error('useCapture needs a CaptureContext provider');
  return capture;
}
