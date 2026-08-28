"use client";

import { useEffect, useState, useCallback } from "react";
import { CallStatus } from "@/lib/types";

export function useCallStatuses() {
  const [statuses, setStatuses] = useState<CallStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return fetch("/api/statuses")
      .then((r) => r.json())
      .then((d) => setStatuses(d.statuses ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { statuses, loading, reload };
}
