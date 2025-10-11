"use client";

import { LifestyleViewContext } from "../LifestyleViewContext";
import { PatientAnalysisPageContent } from "../page";

export default function LifestyleAnalysisPage() {
  return (
    <LifestyleViewContext.Provider value={true}>
      <PatientAnalysisPageContent />
    </LifestyleViewContext.Provider>
  );
}
