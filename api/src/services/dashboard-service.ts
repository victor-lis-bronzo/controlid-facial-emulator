/**
 * DashboardService — aggregate counts and recent activity for the Dashboard
 * (Req 9).
 *
 * Returns the total count of Users, Groups, Access Rules, and Portals (0 when an
 * entity type has no records, Req 9.3) plus the 10 most-recent Access Log
 * records, newest-first, via {@link AccessLogRepository.recent} (Req 9.1, 9.2).
 *
 * See design.md → "Admin services → DashboardService".
 */
import type { AccessLogRepository } from '../repositories/access-log-repository.js';
import type { AccessRuleRepository } from '../repositories/access-rule-repository.js';
import type { GroupRepository } from '../repositories/group-repository.js';
import type { PortalRepository } from '../repositories/portal-repository.js';
import type { UserRepository } from '../repositories/user-repository.js';
import type { AccessLogRecord } from '../shared/index.js';

/** The number of most-recent Access Log records surfaced on the Dashboard (Req 9.2). */
const RECENT_LOG_LIMIT = 10;

/** Aggregate entity counts shown on the Dashboard (Req 9.1, 9.3). */
export interface DashboardCounts {
  users: number;
  groups: number;
  accessRules: number;
  portals: number;
}

/** The Dashboard payload: aggregate counts + recent logs (Req 9.1, 9.2). */
export interface DashboardData {
  counts: DashboardCounts;
  recentLogs: AccessLogRecord[];
}

export class DashboardService {
  public constructor(
    private readonly users: UserRepository,
    private readonly groups: GroupRepository,
    private readonly accessRules: AccessRuleRepository,
    private readonly portals: PortalRepository,
    private readonly accessLogs: AccessLogRepository,
  ) {}

  /**
   * Compute the Dashboard aggregate counts and the 10 most-recent Access Log
   * records (Req 9.1–9.3).
   */
  async load(): Promise<DashboardData> {
    const [users, groups, accessRules, portals, recentLogs] = await Promise.all([
      this.users.listAdmin(),
      this.groups.list(),
      this.accessRules.list(),
      this.portals.list(),
      this.accessLogs.recent(RECENT_LOG_LIMIT),
    ]);
    return {
      counts: {
        users: users.length,
        groups: groups.length,
        accessRules: accessRules.length,
        portals: portals.length,
      },
      recentLogs,
    };
  }
}
