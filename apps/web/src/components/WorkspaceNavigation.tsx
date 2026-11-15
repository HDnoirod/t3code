import { openQuickCapture } from "./workspaceHub/hub";
import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  NotebookPenIcon,
  WrenchIcon,
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelsTopLeftIcon,
  SettingsIcon,
} from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function WorkspaceNavigation({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const settings = pathname === "/settings" || pathname.startsWith("/settings/");
  const work = !settings && !["/calendar", "/notes", "/toolbox", "/usage"].includes(pathname);
  return (
    <nav className="workspace-navigation" aria-label="Main navigation" data-expanded={expanded}>
      <div className="workspace-navigation-titlebar drag-region" />
      <div className="workspace-navigation-links">
        {(
          [
            { to: "/hub", label: "Work", Icon: PanelsTopLeftIcon, active: work },
            { to: "/notes", label: "Notes", Icon: NotebookPenIcon, active: pathname === "/notes" },
            {
              to: "/calendar",
              label: "Time",
              Icon: CalendarDaysIcon,
              active: pathname === "/calendar",
            },
            { to: "/toolbox", label: "Tools", Icon: WrenchIcon, active: pathname === "/toolbox" },
          ] as const
        ).map(({ to, label, Icon, active }) => (
          <Link
            key={to}
            to={to}
            className="workspace-navigation-link"
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
          </Link>
        ))}
        <button
          type="button"
          className="workspace-navigation-link"
          onClick={() => openQuickCapture()}
          aria-label="Quick capture"
        >
          <PlusIcon aria-hidden="true" size={20} />
          <span>Capture</span>
        </button>
      </div>
      <div className="workspace-navigation-collapse">
        <Link
          to="/settings"
          className="workspace-navigation-link"
          aria-current={settings ? "page" : undefined}
        >
          <SettingsIcon aria-hidden="true" size={20} />
          <span>Settings</span>
        </Link>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
              />
            }
          >
            {expanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </TooltipTrigger>
          <TooltipPopup side="right">
            {expanded ? "Collapse navigation" : "Expand navigation"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </nav>
  );
}
