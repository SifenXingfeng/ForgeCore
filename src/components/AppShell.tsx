import type { ReactNode } from "react";
import { motion } from "motion/react";
import Sidebar, { type AppPage } from "./Sidebar";
import Topbar, { type TopbarProps } from "./Topbar";

const ease = [0.16, 1, 0.3, 1] as const;

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
      <motion.main
        key={currentPage}
        id="forgecore-main"
        className="fc-shell__main"
        tabIndex={-1}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease }}
      >
        {children}
      </motion.main>
    </div>
  );
}

export default AppShell;
