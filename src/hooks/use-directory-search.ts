import { useEffect, useState } from "react";

export function useDirectorySearch(input: string) {
  const text = (input.slice(0, 100).match(/[\p{L}\p{M}\p{N}-]+/gu) ?? []).join(" ");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text), 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  const valid = text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
  return { term, valid, waiting: term !== text };
}
