"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Refresh the dynamic server page; the existing tables keep their client state.
export function BenchmarkRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/benchmarks") return;

    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    function stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    }
    function syncVisibility() {
      stop();
      if (document.visibilityState === "visible") {
        timer = setInterval(() => {
          if (!disposed && document.visibilityState === "visible") {
            router.refresh();
          }
        }, 30_000);
      }
    }

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [pathname, router]);

  return null;
}
