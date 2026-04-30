import type { ProjectRecord } from '../types';

type WorkspaceStep = 1 | 2 | 3 | 4;

interface ProjectStepStripCopy {
  processFlow: string;
}

interface ProjectStepStripProps {
  activeStepLabels: readonly string[];
  copy: ProjectStepStripCopy;
  project: ProjectRecord;
  getMaxNavigableStep: (project: ProjectRecord) => number;
  onStepClick: (step: WorkspaceStep) => void;
}

export function ProjectStepStrip({
  activeStepLabels,
  copy,
  project,
  getMaxNavigableStep,
  onStepClick
}: ProjectStepStripProps) {
  return (
    <section className="panel steps-panel">
      <div className="panel-head stacked">
        <strong>{copy.processFlow}</strong>
      </div>
      <div className="step-strip">
        {activeStepLabels.map((label, index) => {
          const step = (index + 1) as WorkspaceStep;
          const clickable = project.status !== 'completed' && step <= getMaxNavigableStep(project);
          return (
            <button
              key={label}
              type="button"
              className={`step-card${project.currentStep === step ? ' active' : ''}${project.currentStep > step ? ' done' : ''}${clickable ? ' enabled' : ''}`}
              onClick={() => onStepClick(step)}
              disabled={!clickable}
            >
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}
