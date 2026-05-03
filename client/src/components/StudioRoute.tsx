import {
  IMPORT_FILE_ACCEPT,
  normalizeHex,
  normalizeHexDraft
} from '../app-utils';
import { StudioWorkspaceShell } from './StudioWorkspaceShell';

interface StudioRouteProps {
  data: any;
}

export function StudioRoute({ data: d }: StudioRouteProps) {
  return (
    <StudioWorkspaceShell
      currentProject={d.currentProject}
      fileInput={{
        accept: IMPORT_FILE_ACCEPT,
        inputRef: d.fileInputRef,
        onUpload: (files: File[]) => void d.handleUpload(files)
      }}
      header={{
        billingSummary: d.billingSummary,
        copy: d.copy,
        currentProjectId: d.currentProjectId,
        historyMenuOpen: d.historyMenuOpen,
        historyMenuRef: d.historyMenuRef,
        isDemoMode: d.isDemoMode,
        locale: d.locale,
        logoMark: d.logoMark,
        session: d.session,
        userMenuOpen: d.userMenuOpen,
        userMenuRef: d.userMenuRef,
        visibleProjects: d.visibleProjects,
        onDeleteProject: d.handleDeleteProject,
        onDownloadProject: d.handleDownloadProject,
        onOpenBilling: (mode: 'topup' | 'billing') => void d.handleOpenBilling(mode),
        onOpenSettings: d.openSettings,
        onRenameProject: (project: any) => void d.handleRenameProject(project),
        onReturnToStudioFeatureCards: d.returnToStudioFeatureCards,
        onSelectProject: (projectId: string) => {
          d.setCurrentProjectId(projectId);
          d.setHistoryMenuOpen(false);
        },
        onSetHistoryMenuOpen: d.setHistoryMenuOpen,
        onSetUserMenuOpen: d.setUserMenuOpen,
        onSignOut: () => void d.signOut()
      }}
      isDemoMode={d.isDemoMode}
      launch={{
        availableFeatureCount: d.availableFeatureCount,
        locale: d.locale,
        visibleStudioFeatures: d.visibleStudioFeatures,
        onOpenFeatureProjectDialog: d.openFeatureProjectDialog
      }}
      message={d.message}
      overlays={{
        accountSettings: {
          busy: d.settingsBusy,
          copy: d.copy,
          draft: d.settingsDraft,
          message: d.settingsMessage,
          open: d.settingsOpen,
          session: d.session,
          setDraft: d.setSettingsDraft,
          onClose: () => d.setSettingsOpen(false),
          onSave: () => void d.handleSaveSettings()
        },
        billingRechargeLayer: d.renderBillingRechargeLayer(),
        createProject: {
          busy: d.busy,
          copy: d.copy,
          dragActive: d.createDialogDragActive,
          fileInputRef: d.createFileInputRef,
          files: d.createDialogFiles,
          locale: d.locale,
          newProjectName: d.newProjectName,
          open: d.createDialogOpen,
          selectedFeature: d.selectedFeature,
          setDragActive: d.setCreateDialogDragActive,
          setNewProjectName: d.setNewProjectName,
          onClose: d.closeCreateProjectDialog,
          onCreate: () => void d.handleCreateProject(),
          onFiles: d.handleCreateDialogFiles
        },
        deleteProject: {
          copy: d.copy,
          locale: d.locale,
          project: d.projectToDelete,
          onCancel: () => d.setProjectToDelete(null),
          onConfirm: () => void d.handleConfirmDeleteProject()
        },
        downloadDialog: {
          busy: d.downloadBusy,
          copy: d.copy,
          draft: d.downloadDraft,
          open: Boolean(d.downloadDialogProjectId),
          project: d.downloadProject,
          stageText: d.downloadStageText,
          setDraft: d.setDownloadDraft,
          onClose: d.closeDownloadDialog,
          onConfirm: () => void d.handleConfirmDownload()
        },
        resultEditor: {
          asset: d.currentViewerAsset,
          aspectRatio: d.currentViewerAspectRatio,
          availableColorCards: d.availableResultColorCards,
          canvasRef: d.resultCanvasRef,
          copy: d.copy,
          currentColor: d.currentViewerSelectedColor,
          currentProjectName: d.currentProject?.name ?? 'Metrovan AI',
          freeRegenerationsRemaining: d.projectFreeRegenerationsRemaining,
          isRegenerating: d.currentViewerIsRegenerating,
          normalizedColor: d.currentViewerNormalizedColor,
          regenerationFreeLimit: d.currentProjectRegenerationUsage.freeLimit,
          safeViewerIndex: d.safeViewerIndex ?? 0,
          settings: d.currentViewerSettings,
          viewerAssets: d.viewerAssets,
          onApplyColorCard: d.applyResultColorCard,
          onClose: () => d.setResultViewerIndex(null),
          onColorBlur: (asset: any, value: string) => {
            const normalized = normalizeHex(value);
            if (normalized) {
              d.applyResultColorCard(asset, normalized);
            }
          },
          onColorDraftChange: (asset: any, value: string) =>
            d.setResultColorCards((current: any) => ({
              ...current,
              [asset.hdrItemId]: normalizeHexDraft(value)
            })),
          onCropFrameDragStart: d.startResultCropFrameDrag,
          onDeleteColorCard: d.deleteResultColorCard,
          onDownload: (asset: any) => void d.downloadViewerAsset(asset),
          onPickColor: (asset: any) => void d.handlePickResultColor(asset),
          onRegenerate: (asset: any) => void d.handleRegenerateResult(asset),
          onReset: d.resetResultEditorSettings,
          onSaveColorCard: d.saveResultColorCard,
          onSelectViewerIndex: d.setResultViewerIndex,
          onShiftViewer: d.shiftViewer,
          onStagePointerDown: d.startResultCropDrag,
          onStagePointerMove: d.moveResultCropDrag,
          onStagePointerUp: d.endResultCropDrag,
          onStageWheel: d.zoomResultCrop,
          onUpdateAspectRatio: d.updateResultAspectRatio,
          onUpdateSettings: d.updateResultEditorSettings,
          resolveMediaUrl: d.resolveMediaUrl
        },
        studioGuide: {
          copy: d.copy,
          open: d.studioGuideOpen,
          activeStep: d.activeStudioGuideStep,
          safeStepIndex: d.safeStudioGuideStep,
          steps: d.studioGuideSteps,
          onClose: d.closeStudioGuide,
          onDismiss: d.dismissStudioGuide,
          onSelectStep: d.setStudioGuideStep,
          onStepDelta: (delta: number) =>
            d.setStudioGuideStep((current: number) =>
              Math.max(0, Math.min(d.studioGuideSteps.length - 1, current + delta))
            )
        }
      }}
      processing={{
        show: d.showProcessingStepContent,
        props: {
          busy: d.busy,
          copy: d.copy,
          locale: d.locale,
          processingPanelDetail: d.processingPanelDetail,
          processingPanelTitle: d.processingPanelTitle,
          showProcessingUploadProgress: d.showProcessingUploadProgress,
          showRecoverUploadAction: d.showRecoverUploadAction,
          showResumeUploadAction: d.showResumeUploadAction,
          showRetryProcessingAction: d.showRetryProcessingAction,
          uploadPaused: d.uploadPaused,
          uploadPercent: d.uploadPercent,
          workspacePointsEstimate: d.workspacePointsEstimate,
          onCancelUpload: d.handleCancelUpload,
          onPauseUpload: d.handlePauseUpload,
          onRecoverUploadFiles: d.triggerFilePicker,
          onResumeProcessingUpload: () => void d.handleStartProcessing(),
          onResumeUpload: d.handleResumeUpload,
          onRetryProcessing: () => void d.handleStartProcessing({ retryFailed: true })
        }
      }}
      results={{
        show: d.showResultsStepContent,
        props: {
          assets: d.displayResultAssets,
          busy: d.busy,
          copy: d.copy,
          currentProjectId: d.currentProject?.id ?? '',
          currentProjectResultAssets: d.currentProject?.resultAssets ?? [],
          dragOverResultHdrItemId: d.dragOverResultHdrItemId,
          draggedResultHdrItemId: d.draggedResultHdrItemId,
          failedResultHdrItems: d.failedResultHdrItems,
          missingResultHdrItems: d.missingResultHdrItems,
          isDemoMode: d.isDemoMode,
          locale: d.locale,
          projectFreeRegenerationsRemaining: d.projectFreeRegenerationsRemaining,
          regenerationFreeLimit: d.currentProjectRegenerationUsage.freeLimit,
          resultCardRefs: d.resultCardRefs,
          resultRegenerateBusy: d.resultRegenerateBusy,
          resultThumbnailUrls: d.resultThumbnailUrls,
          showRetryProcessingAction: d.showRetryProcessingAction,
          getResultColorCard: d.getResultColorCard,
          onOpenViewer: d.openViewer,
          onPickResultColor: (asset: any) => void d.handlePickResultColor(asset),
          onPreviewResultReorder: d.previewResultReorder,
          onRegenerateResult: (asset: any) => void d.handleRegenerateResult(asset),
          onReorderResults: (sourceHdrItemId: string, targetHdrItemId: string) =>
            void d.handleReorderResults(sourceHdrItemId, targetHdrItemId),
          onRetryProcessing: () => void d.handleStartProcessing({ retryFailed: true }),
          onSetDragOverResultHdrItemId: d.setDragOverResultHdrItemId,
          onSetDraggedResultHdrItemId: d.setDraggedResultHdrItemId,
          onSetResultColorCard: (hdrItemId: string, color: string) =>
            d.setResultColorCards((current: any) => ({
              ...current,
              [hdrItemId]: color
            })),
          onSetResultDragPreview: d.setResultDragPreview,
          resolveMediaUrl: d.resolveMediaUrl
        }
      }}
      review={{
        copy: d.copy,
        show: d.showReviewStepContent,
        showLocalImportDiagnostics: d.showLocalImportDiagnostics,
        localDraftDiagnostics: d.localDraftDiagnostics,
        header: {
          busy: d.busy,
          copy: d.copy,
          showAdvancedGroupingControls: d.showAdvancedGroupingControls,
          showProcessingGroupGrid: d.showProcessingGroupGrid,
          showReviewActions: d.showReviewActions,
          showReviewUploadProgress: d.showReviewUploadProgress,
          uploadActive: d.uploadActive,
          workspaceHdrItemCount: d.workspaceHdrItems.length,
          onAddPhotos: d.triggerFilePicker,
          onConfirmSend: () => void d.handleStartProcessing(),
          onCreateGroup: () => void d.handleCreateGroup()
        },
        uploadStatus: {
          busy: d.busy,
          copy: d.copy,
          failedUploadFiles: d.failedUploadFiles,
          locale: d.locale,
          showReviewLocalImportProgress: d.showReviewLocalImportProgress,
          showReviewUploadProgress: d.showReviewUploadProgress,
          uploadPaused: d.uploadPaused,
          uploadProgressLabel: d.uploadProgressLabel,
          uploadProgressWidth: d.uploadProgressWidth,
          onCancelUpload: d.handleCancelUpload,
          onPauseUpload: d.handlePauseUpload,
          onResumeUpload: d.handleResumeUpload,
          onRetryAllUploadFiles: () => void d.handleStartProcessing(),
          onRetryUploadFile: (fileIdentity: string) =>
            void d.handleStartProcessing({ retryUploadFileIdentity: fileIdentity })
        },
        groups: {
          activeLocalDraft: d.activeLocalDraft,
          canEditHdrGrouping: d.canEditHdrGrouping,
          copy: d.copy,
          getColorModeLabel: d.getColorModeLabel,
          getGroupColorDraft: d.getGroupColorDraft,
          getGroupItems: d.getGroupItems,
          getHdrItemStatusLabel: d.getHdrItemStatusLabel,
          getHdrLocalReviewState: d.getHdrLocalReviewState,
          getHdrPreviewUrl: d.getHdrPreviewUrl,
          getLocalReviewCopy: d.getLocalReviewCopy,
          getSceneLabel: d.getSceneLabel,
          getSelectedExposure: d.getSelectedExposure,
          handleApplyGroupColor: d.handleApplyGroupColor,
          handleColorModeChange: d.handleColorModeChange,
          handleDeleteHdr: d.handleDeleteHdr,
          handleHdrExposureSwipeEnd: d.handleHdrExposureSwipeEnd,
          handleHdrExposureSwipeStart: d.handleHdrExposureSwipeStart,
          handleMergeLocalHdrItem: d.handleMergeLocalHdrItem,
          handleMoveHdrItem: d.handleMoveHdrItem,
          handleSceneChange: d.handleSceneChange,
          handleShiftExposure: d.handleShiftExposure,
          handleSplitLocalHdrItem: d.handleSplitLocalHdrItem,
          hdrExposureSwipeRef: d.hdrExposureSwipeRef,
          isDemoMode: d.isDemoMode,
          isHdrItemProcessing: d.isHdrItemProcessing,
          locale: d.locale,
          setGroupColorOverrides: d.setGroupColorOverrides,
          showAdvancedGroupingControls: d.showAdvancedGroupingControls,
          showProcessingGroupGrid: d.showProcessingGroupGrid,
          workspaceGroups: d.workspaceGroups,
          workspaceHdrItems: d.workspaceHdrItems,
          workspaceReviewProject: d.workspaceReviewProject
        }
      }}
      steps={{
        activeStepLabels: d.activeStepLabels,
        copy: d.copy,
        getMaxNavigableStep: d.getMaxNavigableStep,
        onStepClick: (step: 1 | 2 | 3 | 4) => void d.handleStepClick(step)
      }}
      upload={{
        show: d.showUploadStepContent,
        props: {
          copy: d.copy,
          dragActive: d.dragActive,
          showUploadProgress: d.showUploadProgress,
          uploadProgressLabel: d.uploadProgressLabel,
          uploadProgressWidth: d.uploadProgressWidth,
          onDragActiveChange: d.setDragActive,
          onFiles: (files: File[]) => void d.handleUpload(files),
          onTriggerFilePicker: d.triggerFilePicker
        }
      }}
      workspaceHeader={{
        copy: d.copy,
        isDemoMode: d.isDemoMode,
        locale: d.locale,
        onRenameProject: (project: any) => void d.handleRenameProject(project),
        onReturnToStudioFeatureCards: d.returnToStudioFeatureCards
      }}
    />
  );
}
