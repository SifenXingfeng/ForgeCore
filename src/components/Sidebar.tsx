import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeInfo,
  Boxes,
  Factory,
  LayoutDashboard,
  Warehouse,
  Workflow,
} from "lucide-react";

export type AppPage =
  | "overview"
  | "editor"
  | "items"
  | "recipes"
  | "simulation"
  | "logistics"
  | "assets";

export interface SidebarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  className?: string;
}

interface NavigationItem {
  id: AppPage;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
}

export const APP_NAVIGATION: readonly NavigationItem[] = [
  {
    id: "overview",
    label: "总览",
    shortLabel: "总览",
    description: "工厂摘要与最近活动",
    icon: LayoutDashboard,
  },
  {
    id: "editor",
    label: "工厂编辑",
    shortLabel: "编辑",
    description: "搭建与配置 3D 工厂",
    icon: Factory,
  },
  {
    id: "items",
    label: "物品库",
    shortLabel: "物品",
    description: "管理物品与参数化模型",
    icon: Boxes,
  },
  {
    id: "recipes",
    label: "配方",
    shortLabel: "配方",
    description: "配置生产输入与输出",
    icon: Workflow,
  },
  {
    id: "simulation",
    label: "仿真监控",
    shortLabel: "仿真",
    description: "运行仿真并查看生产指标",
    icon: Activity,
  },
  {
    id: "logistics",
    label: "仓储物流",
    shortLabel: "物流",
    description: "查看仓储、运输与任务",
    icon: Warehouse,
  },
  {
    id: "assets",
    label: "资产与许可",
    shortLabel: "资产",
    description: "审计模型来源与使用许可",
    icon: BadgeInfo,
  },
] as const;

export function Sidebar({
  currentPage,
  onNavigate,
  className = "",
}: SidebarProps) {
  return (
    <aside className={`fc-sidebar ${className}`.trim()}>
      <nav className="fc-sidebar__nav" aria-label="ForgeCore 主导航">
        <ul className="fc-sidebar__list">
          {APP_NAVIGATION.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === currentPage;

            return (
              <li key={item.id} className="fc-sidebar__item">
                <button
                  type="button"
                  className="fc-sidebar__link"
                  aria-current={isActive ? "page" : undefined}
                  aria-label={`${item.label}：${item.description}`}
                  title={item.description}
                  onClick={() => onNavigate(item.id)}
                >
                  <span className="fc-sidebar__indicator" aria-hidden="true" />
                  <Icon className="fc-sidebar__icon" aria-hidden="true" />
                  <span className="fc-sidebar__label">{item.label}</span>
                  <span className="fc-sidebar__short-label" aria-hidden="true">
                    {item.shortLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

export default Sidebar;
