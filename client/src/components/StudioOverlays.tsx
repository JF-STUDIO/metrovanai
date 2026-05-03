import type { ReactNode } from 'react';
import { AccountSettingsDialog } from './AccountSettingsDialog';
import { DeleteProjectConfirmDialog } from './DeleteProjectConfirmDialog';
import { FeatureCreateDialog } from './FeatureCreateDialog';
import { ProjectDownloadDialog } from './ProjectDownloadDialog';
import { ResultEditorDialog } from './ResultEditorDialog';
import { StudioGuideDialog } from './StudioGuideDialog';

interface StudioOverlaysProps {
  accountSettings: any;
  billingRechargeLayer: ReactNode;
  createProject: any;
  deleteProject: any;
  downloadDialog: any;
  resultEditor: any;
  studioGuide: any;
}

export function StudioOverlays({
  accountSettings,
  billingRechargeLayer,
  createProject,
  deleteProject,
  downloadDialog,
  resultEditor,
  studioGuide
}: StudioOverlaysProps) {
  return (
    <>
      <StudioGuideDialog
        copy={studioGuide.copy}
        open={studioGuide.open}
        activeStep={studioGuide.activeStep}
        safeStepIndex={studioGuide.safeStepIndex}
        steps={studioGuide.steps}
        onClose={studioGuide.onClose}
        onDismiss={studioGuide.onDismiss}
        onSelectStep={studioGuide.onSelectStep}
        onStepDelta={studioGuide.onStepDelta}
      />

      {billingRechargeLayer}

      {accountSettings.open && accountSettings.session && (
        <AccountSettingsDialog
          busy={accountSettings.busy}
          copy={accountSettings.copy}
          draft={accountSettings.draft}
          message={accountSettings.message}
          session={accountSettings.session}
          setDraft={accountSettings.setDraft}
          onClose={accountSettings.onClose}
          onSave={accountSettings.onSave}
        />
      )}

      {createProject.open && (
        <FeatureCreateDialog
          busy={createProject.busy}
          copy={createProject.copy}
          dragActive={createProject.dragActive}
          fileInputRef={createProject.fileInputRef}
          files={createProject.files}
          locale={createProject.locale}
          newProjectName={createProject.newProjectName}
          selectedFeature={createProject.selectedFeature}
          setDragActive={createProject.setDragActive}
          setNewProjectName={createProject.setNewProjectName}
          onClose={createProject.onClose}
          onCreate={createProject.onCreate}
          onFiles={createProject.onFiles}
        />
      )}

      {downloadDialog.open && downloadDialog.project && (
        <ProjectDownloadDialog
          busy={downloadDialog.busy}
          copy={downloadDialog.copy}
          draft={downloadDialog.draft}
          project={downloadDialog.project}
          stageText={downloadDialog.stageText}
          setDraft={downloadDialog.setDraft}
          onClose={downloadDialog.onClose}
          onConfirm={downloadDialog.onConfirm}
        />
      )}

      {resultEditor.asset && (
        <ResultEditorDialog
          asset={resultEditor.asset}
          aspectRatio={resultEditor.aspectRatio}
          availableColorCards={resultEditor.availableColorCards}
          canvasRef={resultEditor.canvasRef}
          copy={resultEditor.copy}
          currentColor={resultEditor.currentColor}
          currentProjectName={resultEditor.currentProjectName}
          freeRegenerationsRemaining={resultEditor.freeRegenerationsRemaining}
          isRegenerating={resultEditor.isRegenerating}
          normalizedColor={resultEditor.normalizedColor}
          regenerationFreeLimit={resultEditor.regenerationFreeLimit}
          safeViewerIndex={resultEditor.safeViewerIndex}
          settings={resultEditor.settings}
          viewerAssets={resultEditor.viewerAssets}
          onApplyColorCard={resultEditor.onApplyColorCard}
          onClose={resultEditor.onClose}
          onColorBlur={resultEditor.onColorBlur}
          onColorDraftChange={resultEditor.onColorDraftChange}
          onCropFrameDragStart={resultEditor.onCropFrameDragStart}
          onDeleteColorCard={resultEditor.onDeleteColorCard}
          onDownload={resultEditor.onDownload}
          onPickColor={resultEditor.onPickColor}
          onRegenerate={resultEditor.onRegenerate}
          onReset={resultEditor.onReset}
          onSaveColorCard={resultEditor.onSaveColorCard}
          onSelectViewerIndex={resultEditor.onSelectViewerIndex}
          onShiftViewer={resultEditor.onShiftViewer}
          onStagePointerDown={resultEditor.onStagePointerDown}
          onStagePointerMove={resultEditor.onStagePointerMove}
          onStagePointerUp={resultEditor.onStagePointerUp}
          onStageWheel={resultEditor.onStageWheel}
          onUpdateAspectRatio={resultEditor.onUpdateAspectRatio}
          onUpdateSettings={resultEditor.onUpdateSettings}
          resolveMediaUrl={resultEditor.resolveMediaUrl}
        />
      )}

      {deleteProject.project && (
        <DeleteProjectConfirmDialog
          copy={deleteProject.copy}
          locale={deleteProject.locale}
          project={deleteProject.project}
          onCancel={deleteProject.onCancel}
          onConfirm={deleteProject.onConfirm}
        />
      )}
    </>
  );
}
