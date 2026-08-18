import type { ReactNode } from "react";
import Sidebar, { type AppPage } from "./Sidebar";
import Topbar, { type TopbarProps } from "./Topbar";

export interface AppShellProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  children: ReactNode;
  topbarProps?: TopbarProps;
}

export function AppShell({
  currentPage,
  onNavigate,
  children,
  topbarProps,
}: AppShellProps) {
  return (
    <div className="fc-shell">
      <a className="fc-skip-link" href="#forgecore-main">
        跳到主要内容
      </a>
      <Topbar {...topbarProps} />
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <main id="forgecore-main" className="fc-shell__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export default AppShell;
