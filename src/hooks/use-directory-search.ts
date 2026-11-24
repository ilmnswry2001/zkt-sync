import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, initialValue = value) {
  const [settled, setSettled] = useState(initialValue);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), 300);
    return () => window.clearTimeout(timer);
  }, [value]);
  return settled;
}

export function useDirectorySearch(input: string) {
  const text = (input.slice(0, 100).match(/[\p{L}\p{M}\p{N}-]+/gu) ?? []).join(" ");
  const term = useDebouncedValue(text, "");
  const valid = text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
  return { term, valid, waiting: term !== text };
}
