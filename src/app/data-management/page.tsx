import type { Metadata } from "next";
import { PatientAnalysisPageContent } from "../patients/PatientAnalysisPageContent";

export const metadata: Metadata = {
  title: "データ管理 | マルミエ",
  description:
    "カルテ・予約・アンケート・広告・傷病名・売上データのCSVアップロードと共有を管理する専用ページです。",
};

export default function DataManagementPage() {
  return <PatientAnalysisPageContent mode="data-management" />;
}
