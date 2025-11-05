import type { KarteRecord } from "@/lib/karteAnalytics";
import type { Reservation } from "@/lib/reservationData";
import type { SurveyData } from "@/lib/surveyData";
import type { ListingCategoryData } from "@/lib/listingData";
import type { DiagnosisRecord } from "@/lib/diagnosisData";
import type { SalesMonthlyData } from "@/lib/salesData";

export type SharedDataBundle = {
  version?: number;
  generatedAt?: string;
  karteRecords: KarteRecord[];
  karteTimestamp?: string | null;
  reservations?: Reservation[];
  reservationsTimestamp?: string | null;
  surveyData?: SurveyData[];
  surveyTimestamp?: string | null;
  listingData?: ListingCategoryData[];
  listingTimestamp?: string | null;
  diagnosisData?: DiagnosisRecord[];
  diagnosisTimestamp?: string | null;
  salesData?: SalesMonthlyData[];
  salesTimestamp?: string | null;
};
