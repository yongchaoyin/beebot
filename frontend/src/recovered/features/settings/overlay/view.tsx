import { useEffect, useState, type ComponentType, type ReactNode } from "react";
// @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#L1
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L131375
import type { SettingsOverlayParams } from "./entrypoint";
import { SandIcon, SandIconButton } from "../../../ui/sand-kit-primitives";
import type { SandIconPlatform } from "../../../ui/sand-icon-registry";
import { OverlayDialog } from "../../../ui/overlay-primitives";
import "./view.css";

export type SettingsSectionId = "general" | "servers" | "router" | "usage" | "beta";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: "settings-gear" | "servers" | "git-branch" | "chart-bars" | "cloud-download";
}

/** Exact registry recovered from main renderer binding wDn. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General", icon: "settings-gear" },
  { id: "servers", label: "Servers", icon: "servers" },
  { id: "router", label: "Router", icon: "git-branch" },
  { id: "usage", label: "Usage & Billing", icon: "chart-bars" },
  { id: "beta", label: "Updates", icon: "cloud-download" }
];

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5468252
export function settingsSectionsForUsage(
  sections: readonly SettingsSection[],
  showUsage: boolean
): readonly SettingsSection[] {
  return showUsage ? sections : sections.filter((section) => section.id !== "usage");
}

export interface SettingsModalShellProps {
  initialSection?: string;
  isOpen: boolean;
  onClose(): void;
  renderSection(section: SettingsSectionId, selectSection: (section: SettingsSectionId) => void): ReactNode;
  sections?: readonly SettingsSection[];
  /** The shipped renderer hides Usage & Billing when its experiment/account gate is closed. */
  showUsage?: boolean;
  /** Suspend the parent overlay while a nested Settings dialog owns focus and dismissal. */
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  trapFocus?: boolean;
  iconPlatform?: SandIconPlatform;
}

export function SettingsModalShell({
  initialSection,
  isOpen,
  onClose,
  renderSection,
  sections = SETTINGS_SECTIONS,
  showUsage = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  trapFocus = true,
  iconPlatform
}: SettingsModalShellProps) {
  const visibleSections = settingsSectionsForUsage(sections, showUsage);
  const firstSection = visibleSections[0]?.id ?? "general";
  const resolveSection = (candidate: string | undefined): SettingsSectionId =>
    visibleSections.some((section) => section.id === candidate) ? candidate as SettingsSectionId : firstSection;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => resolveSection(initialSection));
  useEffect(() => {
    if (!visibleSections.some((section) => section.id === activeSection)) {
      setActiveSection(firstSection);
    }
  }, [activeSection, firstSection, showUsage]);

  useEffect(() => {
    if (isOpen && initialSection != null) setActiveSection(resolveSection(initialSection));
  }, [initialSection, isOpen, showUsage]);

  if (!isOpen) return null;
  const active = visibleSections.find((section) => section.id === activeSection) ?? visibleSections[0];
  if (active == null) return null;
  const panelId = `sand-settings-panel-${active.id}`;
  const headingId = `${panelId}-heading`;
  return (
    <OverlayDialog
      className="sand-settings-dialog"
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      label="BeeBot settings"
      onClose={onClose}
      open={isOpen}
      trapFocus={trapFocus}
    >
      <div className="sand-settings-layout">
        <nav aria-label="Settings sections" className="sand-settings-nav">
          {visibleSections.map((section) => {
            const selected = section.id === active.id;
            return (
              <button
                aria-controls={selected ? panelId : undefined}
                aria-current={selected ? "page" : undefined}
                className="sand-settings-nav__item"
                data-active={selected || undefined}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <SandIcon name={section.icon} platform={iconPlatform} size="sm" />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>

        <section aria-labelledby={headingId} className="sand-settings-panel" id={panelId}>
          <SandIconButton aria-label="Close" className="sand-settings-panel__close" icon="close" label="Close" onClick={onClose} size="sm" />
          <h2 id={headingId}>{active.label}</h2>
          <div className="sand-settings-panel__body">{renderSection(active.id, (section) => setActiveSection(resolveSection(section)))}</div>
        </section>
      </div>
    </OverlayDialog>
  );
}

export interface SettingsModalProps {
  initialSection?: string;
  isOpen: boolean;
  [key: string]: unknown;
}

export function createSettingsOverlayView<Props extends Record<string, unknown>>(
  useSettingsProps: () => Props,
  SettingsModal: ComponentType<Props & SettingsModalProps>
) {
  return function SettingsOverlayView({ params }: { params: SettingsOverlayParams }) {
    const props = useSettingsProps();
    return <SettingsModal {...props} initialSection={params.section} isOpen />;
  };
}

export default function SettingsOverlaySourceBoundary(_props: { params: SettingsOverlayParams }) {
  return null;
}
