import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import english from "./ui-en.json";

export type Language = "ar" | "en";
const catalogue: Record<string, string> = english;
const preference = "emad_language";
let browserLanguage: Language | undefined;

export const language = createIsomorphicFn()
  .server((): Language => getCookie(preference) === "en" ? "en" : "ar")
  .client((): Language => browserLanguage ??= document.cookie.split(";").some(part => part.trim() === preference + "=en") ? "en" : "ar");

export const direction = () => language() === "en" ? "ltr" : "rtl";
export const displayLocale = () => language() === "en" ? "en-IQ" : "ar-IQ";

export function switchLanguage() {
  document.cookie = `${preference}=${language() === "en" ? "ar" : "en"}; Max-Age=31536000; Path=/; SameSite=Lax`;
  window.location.reload();
}

// Look up interface copy at the point of display. Database keys and form values use their originals.
export function ui<T>(value: T): T extends string ? string : T;
export function ui(value: unknown): unknown {
  if (typeof value !== "string" || language() !== "en") return value;
  const key = value.trim().replace(/\s+/g, " ");
  const translated = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
  return translated ? value.replace(/\S[\s\S]*\S|\S/, () => translated) : value;
}
