"use client";

import { LifestyleViewContext } from "../LifestyleViewContext";
import PatientAnalysisPage from "../page";

export default function LifestyleAnalysisPage() {
  return (
    <LifestyleViewContext.Provider value={true}>
      <PatientAnalysisPage />
    </LifestyleViewContext.Provider>
  );
}
