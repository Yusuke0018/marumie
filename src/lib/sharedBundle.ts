import type { KarteRecord } from "@/lib/karteAnalytics";
import type { Reservation } from "@/lib/reservationData";
import type { LeadtimeMetrics } from "@/lib/leadtimeMetrics";
import type { SurveyData } from "@/lib/surveyData";
import type { ListingCategoryData } from "@/lib/listingData";

export type SharedDataBundle = {
  version?: number;
  generatedAt?: string;
  karteRecords: KarteRecord[];
  karteTimestamp?: string | null;
  reservations?: Reservation[];
  reservationsTimestamp?: string | null;
  leadtimeMetrics?: LeadtimeMetrics;
  surveyData?: SurveyData[];
  surveyTimestamp?: string | null;
  listingData?: ListingCategoryData[];
  listingTimestamp?: string | null;
};
