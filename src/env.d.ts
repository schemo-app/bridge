interface Window {
  __schemoHook?: boolean;
  __schemoEnabled?: boolean;
  __schemoBridge?: boolean;
}

interface XMLHttpRequest {
  __schemo?: {
    method: string;
    url: string;
    requestHeaders: Record<string, string>;
    startedAt: number;
  };
}
