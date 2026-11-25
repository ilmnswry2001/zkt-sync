import { createContext } from "react";
import type { sectionGuide } from "./section-guide";
import type { LucideIcon } from "lucide-react";

export type GuideGroup = {
  key: string;
  label: string;
  items: readonly { to: keyof typeof sectionGuide; label: string; icon: LucideIcon }[];
};

export const GuideNavigation = createContext<readonly GuideGroup[]>([]);
