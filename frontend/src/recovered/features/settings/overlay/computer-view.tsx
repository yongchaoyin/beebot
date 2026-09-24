import { SettingsGroup } from "./computer-view-internals";
import { settingsComputerPhase, useSettingsComputerController, type SettingsComputerMount } from "./computer";
import { SandButton } from "../../../ui/sand-kit-primitives";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L523

const UPDATE_COPY = "Updates the computer your assistants share. Your files and logins stay. All assistants update together.";
const UP_TO_DATE_COPY = "Your computer is on the latest version";
const BUSY_COPY = "An agent is working. Updating now will interrupt it.";
const QUEUED_COPY = "Update queued. It runs as soon as every agent is done.";
const BLOCKED_COPY = "Further computer updates and resets are disabled for this session. Restart BeeBot after the computer is available again.";
const RESET_COPY = "Start fresh if the computer gets stuck. It's rebuilt from your last saved snapshot, so very recent changes may be lost.";
const RESET_UNAVAILABLE_COPY = "Open an agent to reset the shared computer";

export function SettingsComputerPanel({ state, actions }: SettingsComputerMount) {
  const phase = settingsComputerPhase(state);
  const controller = useSettingsComputerController(state, actions);
  const updateExtraCopy = state.isRebuildBlocked
    ? BLOCKED_COPY
    : phase === "queued"
      ? QUEUED_COPY
      : phase === "busy-override"
        ? BUSY_COPY
        : null;
  const resetExtraCopy = state.isRebuildBlocked ? BLOCKED_COPY : !state.canResetBox ? RESET_UNAVAILABLE_COPY : null;

  return (
    <SettingsGroup title="BeeBot's Computer">
      {phase === "up-to-date" && !state.isRebuildBlocked ? (
        <div className="sand-settings-uptodate-banner" role="status">
          <strong>{UP_TO_DATE_COPY}</strong>
          <span>{UPDATE_COPY}</span>
        <SandButton className="sand-settings-reset" disabled={controller.updateDisabled} onClick={controller.requestUpdate} size="md" variant="secondary">{controller.updateLabel}</SandButton>
        </div>
      ) : (
        <SettingsComputerRow
          description={UPDATE_COPY}
          extraCopy={updateExtraCopy}
          label="Update BeeBot's Computer"
          control={<SandButton className="sand-settings-reset" data-confirming={controller.updateConfirming || undefined} disabled={controller.updateDisabled} onClick={controller.requestUpdate} size="md" variant="secondary">{controller.updateLabel}</SandButton>}
        />
      )}
      {state.isDevBuild ? <SandButton className="sand-settings-force-refresh" disabled={state.isRebuildBlocked || state.isUpdateBoxPending || state.isResetBoxPending} onClick={controller.refreshAnyway} size="md" title="Test the update flow even though the computer is already up to date" variant="secondary">Refresh Anyway</SandButton> : null}
      <SettingsComputerRow
        description={RESET_COPY}
        extraCopy={resetExtraCopy}
        label="Reset BeeBot's Computer"
        control={<SandButton className="sand-settings-reset" disabled={!state.canResetBox || state.isRebuildBlocked || state.isUpdateBoxPending || state.isResetBoxPending} onClick={controller.requestReset} sentiment="danger" size="md" variant="primary">{state.isResetBoxPending ? "Resetting…" : "Reset"}</SandButton>}
      />
    </SettingsGroup>
  );
}

function SettingsComputerRow({ description, extraCopy, label, control }: { description: string; extraCopy: string | null; label: string; control: React.ReactNode }) {
  return (
    <div className="sand-settings-row">
      <div className="sand-settings-copy">
        <strong>{label}</strong>
        <span className="sand-settings-field__hint">{description}</span>
        {extraCopy ? <span className="sand-settings-field__hint">{extraCopy}</span> : null}
      </div>
      <div className="sand-settings-control">{control}</div>
    </div>
  );
}
