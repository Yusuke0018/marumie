export type KarteVisitType = "初診" | "再診" | "不明";

export type KarteRecord = {
  dateIso: string;
  monthKey: string;
  visitType: KarteVisitType;
  patientNumber: number | null;
  birthDateIso: string | null;
  department?: string | null;
  points?: number | null;
  patientNameNormalized?: string | null;
  patientAddress?: string | null;
};

export type KarteMonthlyStat = {
  month: string;
  totalPatients: number;
  pureFirstVisits: number;
  returningFirstVisits: number;
  revisitCount: number;
  endoscopyCount: number;
  averageAge: number | null;
};

const MONTH_SORT = (a: string, b: string) => a.localeCompare(b);

const clampToOneDecimal = (value: number) => Math.round(value * 10) / 10;

const calcAge = (birthDate: Date, visitDate: Date) => {
  let age = visitDate.getFullYear() - birthDate.getFullYear();
  const visitMonth = visitDate.getMonth();
  const birthMonth = birthDate.getMonth();

  if (
    visitMonth < birthMonth ||
    (visitMonth === birthMonth && visitDate.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return age;
};

const toDateFromIso = (iso: string) => {
  const [yearStr, monthStr, dayStr] = iso.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Date(year, month - 1, day)
    : null;
};

export const ENDOSCOPY_DEPARTMENT_KEYWORDS = [
  "内視鏡（保険）",
  "内視鏡（自費）",
  "内視鏡(保険)",
  "内視鏡(自費)",
  "人間ドックA",
  "人間ドックB",
];

const normalizeDepartmentLabel = (value: string | null | undefined) =>
  typeof value === "string" ? value.replace(/\s+/g, "") : "";

export const isEndoscopyDepartment = (department: string | null | undefined): boolean => {
  if (!department) {
    return false;
  }
  const normalized = normalizeDepartmentLabel(department);
  if (!normalized) {
    return false;
  }
  return ENDOSCOPY_DEPARTMENT_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.replace(/\s+/g, "")),
  );
};

export type KarteVisitCategory = "pureFirst" | "returningFirst" | "revisit" | "unknown";

export type KarteRecordWithCategory = KarteRecord & {
  category: KarteVisitCategory;
};

export function classifyKarteRecords(records: KarteRecord[]): KarteRecordWithCategory[] {
  if (records.length === 0) {
    return [];
  }

  const monthMap = new Map<string, KarteRecord[]>();
  for (const record of records) {
    if (!monthMap.has(record.monthKey)) {
      monthMap.set(record.monthKey, []);
    }
    monthMap.get(record.monthKey)!.push(record);
  }

  const months = Array.from(monthMap.keys()).sort(MONTH_SORT);
  const classified: KarteRecordWithCategory[] = [];

  for (let index = 0; index < months.length; index++) {
    const month = months[index];
    const currentRecords = [...(monthMap.get(month) ?? [])].sort((a, b) =>
      a.dateIso.localeCompare(b.dateIso),
    );

    const previousMonth = index > 0 ? months[index - 1] : null;
    const previousRecords = previousMonth ? monthMap.get(previousMonth) ?? [] : [];

    const previousNumbers = new Set<number>();
    let previousMaxNumber: number | null = null;

    for (const record of previousRecords) {
      if (record.patientNumber === null) {
        continue;
      }
      previousNumbers.add(record.patientNumber);
      if (previousMaxNumber === null || record.patientNumber > previousMaxNumber) {
        previousMaxNumber = record.patientNumber;
      }
    }

    for (const record of currentRecords) {
      let category: KarteVisitCategory = "unknown";

      // 健康診断・人間ドック・予防接種は初再診の概念がないため純初診として扱う
      const department = record.department?.trim() ?? "";
      const isPreventiveCare =
        department.includes("健康診断") ||
        department.includes("人間ドック") ||
        department.includes("予防接種");

      if (isPreventiveCare) {
        category = "pureFirst";
      } else if (record.visitType === "再診") {
        category = "revisit";
      } else if (record.visitType === "初診") {
        const patientNumber = record.patientNumber;
        let isPureFirst = false;

        if (patientNumber === null) {
          isPureFirst = previousMaxNumber === null;
        } else if (previousMaxNumber === null) {
          isPureFirst = true;
        } else if (patientNumber > previousMaxNumber) {
          isPureFirst = true;
        } else if (patientNumber >= previousMaxNumber - 200) {
          isPureFirst = !previousNumbers.has(patientNumber);
        } else {
          isPureFirst = false;
        }

        category = isPureFirst ? "pureFirst" : "returningFirst";
      }

      classified.push({
        ...record,
        category,
      });
    }
  }

  return classified;
}

export function aggregateKarteMonthly(records: KarteRecord[]): KarteMonthlyStat[] {
  if (records.length === 0) {
    return [];
  }

  const classified = classifyKarteRecords(records);

  const monthStats = new Map<
    string,
    {
      totalPatients: number;
      pureFirstVisits: number;
      returningFirstVisits: number;
      revisitCount: number;
      endoscopyCount: number;
      ageSum: number;
      ageCount: number;
    }
  >();

  for (const record of classified) {
    const monthKey = record.monthKey;
    if (!monthStats.has(monthKey)) {
      monthStats.set(monthKey, {
        totalPatients: 0,
        pureFirstVisits: 0,
        returningFirstVisits: 0,
        revisitCount: 0,
        endoscopyCount: 0,
        ageSum: 0,
        ageCount: 0,
      });
    }

    const bucket = monthStats.get(monthKey)!;
    bucket.totalPatients += 1;
    if (isEndoscopyDepartment(record.department)) {
      bucket.endoscopyCount += 1;
    }

    if (record.category === "pureFirst") {
      bucket.pureFirstVisits += 1;
    } else if (record.category === "returningFirst") {
      bucket.returningFirstVisits += 1;
    } else if (record.category === "revisit") {
      bucket.revisitCount += 1;
    }

    if (record.birthDateIso) {
      const birthDate = toDateFromIso(record.birthDateIso);
      const visitDate = toDateFromIso(record.dateIso);
      if (birthDate && visitDate) {
        const age = calcAge(birthDate, visitDate);
        if (age >= 0 && age < 120) {
          bucket.ageSum += age;
          bucket.ageCount += 1;
        }
      }
    }
  }

  return Array.from(monthStats.entries())
    .sort((a, b) => MONTH_SORT(a[0], b[0]))
    .map(([month, bucket]) => ({
      month,
      totalPatients: bucket.totalPatients,
      pureFirstVisits: bucket.pureFirstVisits,
      returningFirstVisits: bucket.returningFirstVisits,
      revisitCount: bucket.revisitCount,
      endoscopyCount: bucket.endoscopyCount,
      averageAge:
        bucket.ageCount > 0 ? clampToOneDecimal(bucket.ageSum / bucket.ageCount) : null,
    }));
}

// 年代区分を定義
export type AgeGroup = "10代以下" | "20代" | "30代" | "40代" | "50代" | "60代" | "70代" | "80代以上" | "不明";

export const AGE_GROUPS: AgeGroup[] = [
  "10代以下",
  "20代",
  "30代",
  "40代",
  "50代",
  "60代",
  "70代",
  "80代以上",
  "不明",
];

// 年齢から年代区分を取得
export function getAgeGroup(age: number | null): AgeGroup {
  if (age === null || age < 0) {
    return "不明";
  }
  if (age < 20) return "10代以下";
  if (age < 30) return "20代";
  if (age < 40) return "30代";
  if (age < 50) return "40代";
  if (age < 60) return "50代";
  if (age < 70) return "60代";
  if (age < 80) return "70代";
  return "80代以上";
}

// 年代別月次統計
export type AgeGroupMonthlyStat = {
  month: string;
  ageGroups: Record<AgeGroup, number>;
  total: number;
};

// 年代別データを月次で集計
export function aggregateKarteByAgeGroup(
  records: KarteRecord[],
  department?: string | null
): AgeGroupMonthlyStat[] {
  if (records.length === 0) {
    return [];
  }

  // 診療科目でフィルタリング
  let filteredRecords = records;
  if (department && department !== "全体") {
    filteredRecords = records.filter((r) => r.department === department);
  }

  const monthStats = new Map<string, Record<AgeGroup, number>>();

  for (const record of filteredRecords) {
    const monthKey = record.monthKey;
    if (!monthStats.has(monthKey)) {
      monthStats.set(monthKey, {
        "10代以下": 0,
        "20代": 0,
        "30代": 0,
        "40代": 0,
        "50代": 0,
        "60代": 0,
        "70代": 0,
        "80代以上": 0,
        "不明": 0,
      });
    }

    const bucket = monthStats.get(monthKey)!;

    if (record.birthDateIso) {
      const birthDate = toDateFromIso(record.birthDateIso);
      const visitDate = toDateFromIso(record.dateIso);
      if (birthDate && visitDate) {
        const age = calcAge(birthDate, visitDate);
        if (age >= 0 && age < 120) {
          const ageGroup = getAgeGroup(age);
          bucket[ageGroup] += 1;
        } else {
          bucket["不明"] += 1;
        }
      } else {
        bucket["不明"] += 1;
      }
    } else {
      bucket["不明"] += 1;
    }
  }

  return Array.from(monthStats.entries())
    .sort((a, b) => MONTH_SORT(a[0], b[0]))
    .map(([month, ageGroups]) => ({
      month,
      ageGroups,
      total: Object.values(ageGroups).reduce((sum, count) => sum + count, 0),
    }));
}

// 診療科目の一覧を取得
export function getDepartmentList(records: KarteRecord[]): string[] {
  const departments = new Set<string>();
  for (const record of records) {
    if (record.department) {
      departments.add(record.department);
    }
  }
  return ["全体", ...Array.from(departments).sort((a, b) => a.localeCompare(b, "ja"))];
}
