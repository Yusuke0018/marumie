export type KarteVisitType = "初診" | "再診" | "不明";

export type KarteRecord = {
  dateIso: string;
  monthKey: string;
  visitType: KarteVisitType;
  patientNumber: number | null;
  birthDateIso: string | null;
  department?: string | null;
};

export type KarteMonthlyStat = {
  month: string;
  totalPatients: number;
  pureFirstVisits: number;
  returningFirstVisits: number;
  revisitCount: number;
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

      if (record.visitType === "再診") {
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
        ageSum: 0,
        ageCount: 0,
      });
    }

    const bucket = monthStats.get(monthKey)!;
    bucket.totalPatients += 1;

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
      averageAge:
        bucket.ageCount > 0 ? clampToOneDecimal(bucket.ageSum / bucket.ageCount) : null,
    }));
}
