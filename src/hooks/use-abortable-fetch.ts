// OPT-2a: abortable fetch hook — cancels in-flight requests on unmount
//
// Background: many widgets in this app poll their API on a setInterval.
// Without AbortController, when the component unmounts the in-flight fetch
// keeps running in the background, eventually calling setState on an unmounted
// component → React "Can't perform a React state update on an unmounted
// component" warning + memory leak.
//
// Usage:
//   const { abortableFetch } = useAbortableFetch();
//   const res = await abortableFetch("/api/foo");
//   if (!res) return;          // null = aborted (unmount / refresh / superseded)
//   const data = await res.json();
//
// The hook tracks a single AbortController. Each new call aborts the previous
// in-flight request — this prevents race conditions where a slow older
// response arrives after a newer one and overwrites fresh state. On unmount,
// the latest controller is aborted automatically.
import { useEffect, useRef, useCallback } from "react";

export function useAbortableFetch() {
  const abortRef = useRef<AbortController | null>(null);

  const abortableFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } catch (err: any) {
      if (err.name === "AbortError") return null; // expected on unmount/refresh
      throw err;
    }
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort(); // cleanup on unmount
  }, []);

  return { abortableFetch };
}
