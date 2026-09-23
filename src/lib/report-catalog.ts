export type CatalogKind = "worker_specialty" | "equipment_type";

export type CatalogItem = {
  id: string;
  kind: CatalogKind;
  name: string;
  sort_order: number;
  is_archived: boolean;
};

export const REPORT_CATALOG_STORAGE_KEY = "zkt-report-catalog-fallback";

export const DEFAULT_REPORT_CATALOG: CatalogItem[] = [
  "إدارة وإشراف",
  "مهندس موقع",
  "مهندس ميكانيك",
  "مهندس كهرباء",
  "مهندس مدني",
  "جيولوجي / فني مختبر",
  "فني أجهزة وتحكم",
  "فني صيانة",
  "لحام وفابريكيشن",
  "سائق",
  "مشغل آلية",
  "عامل حفر",
  "عامل خدمات / نظافة",
  "حراسة وأمن",
  "إسعاف وسلامة HSE",
]
  .map((name, index) => ({
    id: `default-worker-${index + 1}`,
    kind: "worker_specialty" as const,
    name,
    sort_order: (index + 1) * 10,
    is_archived: false,
  }))
  .concat(
    [
      "حفارة",
      "رافعة",
      "شيول / لودر",
      "بلدوزر",
      "كريدر",
      "قلّاب",
      "صهريج ماء",
      "صهريج وقود",
      "مركبة دفع رباعي",
      "باص نقل",
      "مولدة كهرباء",
      "ضاغطة هواء",
      "معدات رفع",
    ].map((name, index) => ({
      id: `default-equipment-${index + 1}`,
      kind: "equipment_type" as const,
      name,
      sort_order: (index + 1) * 10,
      is_archived: false,
    })),
  );

function isCatalogItem(value: unknown): value is CatalogItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CatalogItem>;
  return (
    typeof item.id === "string" &&
    (item.kind === "worker_specialty" || item.kind === "equipment_type") &&
    typeof item.name === "string" &&
    typeof item.sort_order === "number" &&
    typeof item.is_archived === "boolean"
  );
}

export function readLocalCatalog(): CatalogItem[] {
  if (typeof window === "undefined") return DEFAULT_REPORT_CATALOG;
  try {
    const stored = JSON.parse(window.localStorage.getItem(REPORT_CATALOG_STORAGE_KEY) ?? "null");
    return Array.isArray(stored) && stored.every(isCatalogItem) ? stored : DEFAULT_REPORT_CATALOG;
  } catch {
    return DEFAULT_REPORT_CATALOG;
  }
}

export function writeLocalCatalog(items: CatalogItem[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(REPORT_CATALOG_STORAGE_KEY, JSON.stringify(items));
  }
}

export function newCatalogId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
