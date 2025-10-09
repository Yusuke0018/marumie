export type KarteVisitType = "初診" | "再診" | "不明";

export type KarteRecord = {
  dateIso: string;
  monthKey: string;
  visitType: KarteVisitType;
  patientNumber: number | null;
  birthDateIso: string | null;
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

export function aggregateKarteMonthly(records: KarteRecord[]): KarteMonthlyStat[] {
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
  const stats: KarteMonthlyStat[] = [];

  for (let index = 0; index < months.length; index++) {
    const month = months[index];
    const currentRecords = monthMap.get(month) ?? [];

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

    let totalPatients = 0;
    let pureFirstVisits = 0;
    let returningFirstVisits = 0;
    let revisitCount = 0;
    let ageSum = 0;
    let ageCount = 0;

    for (const record of currentRecords) {
      totalPatients += 1;

      if (record.visitType === "再診") {
        revisitCount += 1;
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

        if (isPureFirst) {
          pureFirstVisits += 1;
        } else {
          returningFirstVisits += 1;
        }
      }

      if (record.birthDateIso) {
        const birthDate = toDateFromIso(record.birthDateIso);
        const visitDate = toDateFromIso(record.dateIso);
        if (birthDate && visitDate) {
          const age = calcAge(birthDate, visitDate);
          if (age >= 0 && age < 120) {
            ageSum += age;
            ageCount += 1;
          }
        }
      }
    }

    stats.push({
      month,
      totalPatients,
      pureFirstVisits,
      returningFirstVisits,
      revisitCount,
      averageAge: ageCount > 0 ? clampToOneDecimal(ageSum / ageCount) : null,
    });
  }

  return stats;
}
