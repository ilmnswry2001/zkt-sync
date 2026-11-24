import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { language, switchLanguage } from "@/lib/ui-language";

export function LanguageSwitch() {
  const english = language() === "en";
  return <Button type="button" size="sm" variant="outline" onClick={switchLanguage}
    aria-label={english ? "التبديل إلى العربية" : "Switch to English"} lang={english ? "ar" : "en"}>
    <Languages aria-hidden className="size-4" />{english ? "العربية" : "English"}
  </Button>;
}
