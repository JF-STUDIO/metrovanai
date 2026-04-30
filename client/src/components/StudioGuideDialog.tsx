interface StudioGuideStep {
  id: string;
  title: string;
  body: string;
}

interface StudioGuideCopy {
  close: string;
  studioGuideDone: string;
  studioGuideDontShow: string;
  studioGuideNext: string;
  studioGuidePrev: string;
  studioGuideStepCount: (step: number, total: number) => string;
  studioGuideSubtitle: string;
  studioGuideTitle: string;
}

interface StudioGuideDialogProps {
  copy: StudioGuideCopy;
  open: boolean;
  activeStep: StudioGuideStep | undefined;
  safeStepIndex: number;
  steps: StudioGuideStep[];
  onClose: () => void;
  onDismiss: () => void;
  onSelectStep: (index: number) => void;
  onStepDelta: (delta: number) => void;
}

export function StudioGuideDialog({
  copy,
  open,
  activeStep,
  safeStepIndex,
  steps,
  onClose,
  onDismiss,
  onSelectStep,
  onStepDelta
}: StudioGuideDialogProps) {
  if (!open || !activeStep) {
    return null;
  }

  const isLastStep = safeStepIndex >= steps.length - 1;

  return (
    <div className="modal-backdrop studio-guide-backdrop" onClick={onClose}>
      <section className="studio-guide-card" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <div className="studio-guide-head">
          <div>
            <span>{copy.studioGuideStepCount(safeStepIndex + 1, steps.length)}</span>
            <strong>{copy.studioGuideTitle}</strong>
            <p>{copy.studioGuideSubtitle}</p>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label={copy.close}>
            ×
          </button>
        </div>

        <div className="studio-guide-meter" aria-hidden="true">
          <span style={{ width: `${((safeStepIndex + 1) / steps.length) * 100}%` }} />
        </div>

        <div className="studio-guide-body">
          <div className="studio-guide-step-number">{String(safeStepIndex + 1).padStart(2, '0')}</div>
          <div>
            <h3>{activeStep.title}</h3>
            <p>{activeStep.body}</p>
          </div>
        </div>

        <div className="studio-guide-step-list" aria-label={copy.studioGuideTitle}>
          {steps.map((step, index) => (
            <button
              key={step.id}
              className={`studio-guide-step-pill${index === safeStepIndex ? ' active' : ''}`}
              type="button"
              onClick={() => onSelectStep(index)}
            >
              <span>{index + 1}</span>
              <strong>{step.title}</strong>
            </button>
          ))}
        </div>

        <div className="studio-guide-actions">
          <button className="ghost-button" type="button" onClick={onDismiss}>
            {copy.studioGuideDontShow}
          </button>
          <div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => onStepDelta(-1)}
              disabled={safeStepIndex === 0}
            >
              {copy.studioGuidePrev}
            </button>
            <button
              className="solid-button"
              type="button"
              onClick={() => {
                if (isLastStep) {
                  onClose();
                  return;
                }
                onStepDelta(1);
              }}
            >
              {isLastStep ? copy.studioGuideDone : copy.studioGuideNext}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
