import {
  Building2,
  CircleAlert,
  CircleCheck,
  Factory,
  House,
  LoaderCircle,
  Pause,
  Play,
  Save,
  Search,
  TriangleAlert,
} from "lucide-react";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface TopbarProps {
  factoryName?: string;
  saveState?: SaveState;
  simRunning?: boolean;
  simSpeed?: number;
  onSave?: () => void;
  onToggleSimulation?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenMainMenu?: () => void;
  className?: string;
}

const SAVE_STATUS_CONTENT = {
  saved: { label: "已保存", icon: CircleCheck, tone: "success" },
  saving: { label: "保存中", icon: LoaderCircle, tone: "info" },
  unsaved: { label: "有未保存更改", icon: CircleAlert, tone: "attention" },
  error: { label: "保存失败", icon: TriangleAlert, tone: "danger" },
} as const;

export function Topbar({
  factoryName = "未命名数字工厂",
  saveState = "saved",
  simRunning = false,
  simSpeed = 1,
  onSave,
  onToggleSimulation,
  onOpenCommandPalette,
  onOpenMainMenu,
  className = "",
}: TopbarProps) {
  const saveContent = SAVE_STATUS_CONTENT[saveState];
  const SaveStatusIcon = saveContent.icon;

  return (
    <header className={`fc-topbar ${className}`.trim()}>
      <div className="fc-topbar__brand" aria-label="ForgeCore">
        <span className="fc-topbar__brand-mark" aria-hidden="true">
          <Factory />
        </span>
        <span className="fc-topbar__brand-copy">
          <strong>ForgeCore</strong>
          <small>DIGITAL FACTORY</small>
        </span>
      </div>

      <div className="fc-topbar__context">
        <Building2 aria-hidden="true" />
        <span className="fc-topbar__context-copy">
          <small>当前工厂</small>
          <strong title={factoryName}>{factoryName}</strong>
        </span>
      </div>

      <div className="fc-topbar__states" aria-live="polite">
        <span className={`fc-topbar__state fc-topbar__state--${saveContent.tone}`}>
          <SaveStatusIcon
            className={saveState === "saving" ? "fc-spin" : undefined}
            aria-hidden="true"
          />
          <span>{saveContent.label}</span>
        </span>
        <span className={`fc-topbar__state fc-topbar__state--${simRunning ? "success" : "attention"}`}>
          <span className="fc-topbar__state-dot" aria-hidden="true" />
          <span>{simRunning ? "运行中" : "已暂停"}</span>
          <strong>{simSpeed}×</strong>
        </span>
      </div>

      <div className="fc-topbar__actions" aria-label="快速操作">
        {onOpenMainMenu && (
          <button
            type="button"
            className="fc-topbar__action"
            onClick={onOpenMainMenu}
            title="返回主菜单"
          >
            <House aria-hidden="true" />
            <span>主菜单</span>
          </button>
        )}
        {onOpenCommandPalette && (
          <button
            type="button"
            className="fc-topbar__action fc-topbar__action--search"
            onClick={onOpenCommandPalette}
            title="搜索与快捷命令"
          >
            <Search aria-hidden="true" />
            <span>搜索</span>
            <kbd>⌘ K</kbd>
          </button>
        )}

        <button
          type="button"
          className="fc-topbar__action fc-topbar__action--save"
          onClick={onSave}
          disabled={!onSave || saveState === "saving"}
          title={onSave ? "保存当前工厂" : "保存操作尚未接入"}
        >
          <Save aria-hidden="true" />
          <span>保存</span>
        </button>

        <button
          type="button"
          className="fc-topbar__action fc-topbar__action--primary"
          onClick={onToggleSimulation}
          disabled={!onToggleSimulation}
          aria-label={simRunning ? "暂停仿真" : "启动仿真"}
          title={
            onToggleSimulation
              ? simRunning
                ? "暂停仿真"
                : "启动仿真"
              : "仿真操作尚未接入"
          }
        >
          {simRunning ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          <span>{simRunning ? "暂停" : "运行"}</span>
        </button>
      </div>
    </header>
  );
}

export default Topbar;
