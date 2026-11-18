import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getOperationalAlerts } from "@/lib/operational-alerts.functions";

export function useOperationalAlerts() {
  const { user, isAdmin, isHR, isCompanyManager, isDepartmentManager } = useAuth();
  const fetchAlerts = useServerFn(getOperationalAlerts);
  const canView = isAdmin || isHR || isCompanyManager || isDepartmentManager;
  const departmentScoped = isDepartmentManager && !isAdmin && !isHR && !isCompanyManager;
  return useQuery({
    queryKey: ["operational-alerts", user?.id, departmentScoped],
    queryFn: () => fetchAlerts(),
    enabled: canView && !!user,
    refetchInterval: 120_000,
  });
}
