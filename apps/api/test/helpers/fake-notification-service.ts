import type { NotificationService } from "../../src/services/notification-service.js";

/**
 * A stub for suites that construct `buildServer` without a database
 * connection (auth/plumbing tests). No route that calls `notify()` is
 * exercised in those files, so a call here is a test bug, not a legitimate
 * path. Same pattern as `unusedRosterService`/`unusedDashboardService`.
 */
export function unusedNotificationService(): NotificationService {
  return {
    notify: () => {
      throw new Error("unused: notificationService was not expected to be called in this suite");
    },
  };
}
