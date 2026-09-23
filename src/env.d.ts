// What the page hooks leave on the page's own window. The interceptor sets them in the MAIN world,
// the bridge in the isolated one, and the worker flips __schemoEnabled from outside to stop capture.
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
